import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const runner = read("scripts/dte/run-automatic-worker-once.mjs");
const route = read("app/api/internal/dte-worker/route.ts");
const worker = read("lib/dte/automation/worker.ts");
const service = read("ops/systemd/citaya-dte-auto-worker.service");
const timer = read("ops/systemd/citaya-dte-auto-worker.timer");
const manualService = read("ops/systemd/citaya-dte-manual-worker.service");
const migration = read(
  "migrations/202608240001_dte_automatic_worker_canary_fencing.sql",
);

test("automatic runner is single-iteration, fail-closed and uses only its target", () => {
  assert.match(runner, /DTE_AUTOMATIC_WORKER_ENABLED === "true"/);
  assert.match(runner, /DTE_PRODUCTION_ENABLED === "true"/);
  assert.match(runner, /DTE_AUTOMATIC_TARGET_OUTBOX_ID/);
  assert.doesNotMatch(runner, /DTE_TARGET_OUTBOX_ID/);
  assert.match(runner, /mode: "automatic"/);
  assert.match(runner, /automaticTargetOutboxId/);
  assert.match(runner, /AbortSignal\.timeout\(12 \* 60 \* 1000\)/);
  assert.doesNotMatch(runner, /setInterval|setTimeout|while\s*\(|for\s*\(;;\)/);
  assert.doesNotMatch(runner, /console\.(?:log|error)\([^\n]*(?:secret|payload|body|url|xml|pem|rut|stack)/i);
});

test("automatic target is propagated only through automatic dispatch", () => {
  const automaticBranch = route.match(
    /if \(mode === "automatic"\) \{[\s\S]*?return NextResponse\.json\(\{ ok: true, result \}\);\n    \}/,
  )?.[0] ?? "";
  assert.match(automaticBranch, /automaticTargetOutboxId/);
  assert.match(automaticBranch, /runOneAutomaticIssuanceWorker\(\{ automaticTargetOutboxId \}\)/);
  assert.doesNotMatch(automaticBranch, /targetOutboxId\s*[},]/);
  assert.match(worker, /dte_claim_automatic_issuance_outbox_exact/);
  assert.match(worker, /options\.automaticTargetOutboxId/);
  assert.match(worker, /const allowedTypes = automatic \? \[33, 39\]/);
  assert.doesNotMatch(worker, /const allowedTypes = automatic \? \[33, 39, 41\]/);
});

test("automatic systemd units are isolated, bounded and non-persistent", () => {
  assert.match(service, /Type=oneshot/);
  assert.match(service, /run-automatic-worker-once\.mjs/);
  assert.match(service, /TimeoutStartSec=13min/);
  assert.match(service, /Restart=no/);
  assert.doesNotMatch(service, /run-manual-worker-once|DTE_TARGET_OUTBOX_ID/);
  assert.match(manualService, /run-manual-worker-once\.mjs/);
  assert.doesNotMatch(manualService, /run-automatic-worker-once/);
  assert.match(timer, /OnUnitInactiveSec=2min/);
  assert.match(timer, /Persistent=false/);
  assert.doesNotMatch(timer, /Persistent=true/);
  assert.match(timer, /Unit=citaya-dte-auto-worker\.service/);
});

test("migration keeps exact claims and stale recovery in separate domains", () => {
  assert.match(migration, /dte_claim_automatic_issuance_outbox_exact/);
  assert.match(migration, /p_require_target and p_target_outbox_id is null/);
  assert.match(migration, /raise exception 'DTE_AUTOMATIC_TARGET_NOT_ELIGIBLE'/);
  assert.match(migration, /o\.issuance_origin = 'automatic_system'/);
  assert.match(migration, /i\.origin = 'automatic_payment'/);
  assert.match(migration, /i\.resolved_dte_type in \(33,39\)/);
  assert.match(migration, /o\.issuance_origin in \('legacy_unknown','manual_admin'\)/);
  assert.match(migration, /PRE_NETWORK_CRASH_STATE_PRESERVED/);
  assert.match(migration, /NETWORK_RESULT_UNKNOWN/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /AUTOMATIC_GATE_CLOSED_PRE_NETWORK/);
  assert.match(migration, /AUTOMATIC_GATE_CLOSED_POST_NETWORK/);
  assert.match(migration, /before_fetch_at is not null/);
  assert.match(migration, /i\.production_document_id is null/);
  assert.match(migration, /tenant\.lifecycle_status = 'active'/);
  assert.match(migration, /tenant\.operational_mode = 'live'/);
  assert.match(migration, /dte_tenant_operational_readiness/);
  assert.match(migration, /dte_activation_gate_report/);
});

test("automatic diagnostics do not persist raw exceptions or stack traces", () => {
  const automaticFailureCall = worker.match(
    /await block\([\s\S]*?automatic \? null : safeFailureDetails\(error\),[\s\S]*?\);/,
  )?.[0] ?? "";
  assert.match(automaticFailureCall, /automatic \? null : safeFailureDetails\(error\)/);
  assert.doesNotMatch(runner, /console\.(?:log|error)\([^\n]*(?:DTE_WORKER_SECRET|response\.text|response\.body|payload)/);
});
