import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const runner = read("scripts/dte/run-automatic-worker-once.mjs");
const route = read("app/api/internal/dte-worker/route.ts");
const worker = read("lib/dte/automation/worker.ts");
const productionServer = read("lib/dte/production/server.ts");
const service = read("ops/systemd/citaya-dte-auto-worker.service");
const timer = read("ops/systemd/citaya-dte-auto-worker.timer");
const manualService = read("ops/systemd/citaya-dte-manual-worker.service");
const migration = read(
  "migrations/202608240001_dte_automatic_worker_canary_fencing.sql",
);
const resumeMigration = read(
  "migrations/202608260002_cit33_claim_owned_folio_resume.sql",
);

test("automatic runner is single-iteration, fail-closed and uses only its target", () => {
  assert.match(runner, /DTE_AUTOMATIC_WORKER_ENABLED === "true"/);
  assert.match(runner, /DTE_PRODUCTION_ENABLED === "true"/);
  assert.match(runner, /DTE_AUTOMATIC_TARGET_OUTBOX_ID/);
  assert.doesNotMatch(runner, /DTE_TARGET_OUTBOX_ID/);
  assert.match(runner, /mode: "automatic"/);
  assert.match(runner, /automaticTargetOutboxId/);
  assert.match(runner, /DTE_AUTOMATIC_OWNED_FOLIO_RESUME/);
  assert.match(runner, /automaticOwnedFolioResume/);
  assert.match(runner, /automaticOwnedFolioResume && !automaticTargetOutboxId/);
  assert.match(runner, /AbortSignal\.timeout\(12 \* 60 \* 1000\)/);
  assert.doesNotMatch(runner, /setInterval|setTimeout|while\s*\(|for\s*\(;;\)/);
  assert.doesNotMatch(runner, /console\.(?:log|error)\([^\n]*(?:secret|payload|body|url|xml|pem|rut|stack)/i);
});

test("automatic target is propagated only through automatic dispatch", () => {
  const automaticBranch = route.match(
    /if \(mode === "automatic"\) \{[\s\S]*?return NextResponse\.json\(\{ ok: true, result \}\);\n    \}/,
  )?.[0] ?? "";
  assert.match(automaticBranch, /automaticTargetOutboxId/);
  assert.match(automaticBranch, /automaticOwnedFolioResume/);
  assert.match(automaticBranch, /runOneAutomaticIssuanceWorker\(\{[\s\S]*automaticTargetOutboxId,[\s\S]*automaticOwnedFolioResume/);
  assert.doesNotMatch(automaticBranch, /targetOutboxId\s*[},]/);
  assert.match(worker, /dte_claim_automatic_issuance_outbox_exact/);
  assert.match(worker, /options\.automaticTargetOutboxId/);
  assert.match(worker, /options\.automaticOwnedFolioResume === true/);
  assert.match(worker, /dte_claim_automatic_owned_folio_resume_exact/);
  assert.match(worker, /const allowedTypes = automatic \? \[33, 39\]/);
  assert.doesNotMatch(worker, /const allowedTypes = automatic \? \[33, 39, 41\]/);
});

test("owned-folio resume is explicit, exact, and has no normal-claim fallback", () => {
  const recoveryBranch = worker.match(
    /: options\.automaticOwnedFolioResume === true[\s\S]*?: targetOutboxId/,
  )?.[0] ?? "";
  assert.match(recoveryBranch, /dte_claim_automatic_owned_folio_resume_exact/);
  assert.doesNotMatch(recoveryBranch, /dte_claim_automatic_issuance_outbox_exact/);
  assert.match(resumeMigration, /returns setof public\.dte_issuance_outbox/);
  assert.match(resumeMigration, /for update/);
  assert.match(resumeMigration, /pg_advisory_xact_lock/);
  assert.match(resumeMigration, /AUTOMATIC_OWNED_FOLIO_RESUME_CLAIMED/);
  assert.match(resumeMigration, /public\.dte_automatic_issuance_gate_open/);
  assert.doesNotMatch(resumeMigration, /order by[\s\S]*limit 1|skip locked|for stale in/);
  assert.match(
    resumeMigration,
    /revoke all on function public\.dte_claim_automatic_owned_folio_resume_exact\([\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant execute[\s\S]*to service_role/,
  );
});

test("CIT-61 pre-network recovery is explicit, exact, and precedes every fallback", () => {
  const recoveryBranch = worker.match(
    /const claimed = options\.automaticPreNetworkResume === true[\s\S]*?: options\.automaticOwnedFolioResume === true/,
  )?.[0] ?? "";
  assert.match(recoveryBranch, /dte_claim_automatic_pre_network_resume_exact/);
  assert.doesNotMatch(recoveryBranch, /dte_claim_automatic_issuance_outbox_exact/);
  assert.match(runner, /DTE_AUTOMATIC_PRE_NETWORK_RESUME/);
  assert.match(route, /automaticPreNetworkResume/);
  assert.match(worker, /dte_begin_automatic_network_attempt/);
});

test("automatic post-RENEW readiness keeps legal activation without reopening the raw report", () => {
  const processStart = worker.indexOf("export async function processClaimedDteItem");
  const renewAt = worker.indexOf('action: "RENEW"', processStart);
  const readinessAt = worker.indexOf("assertTenantReadyForIssuance", renewAt);
  assert.ok(renewAt > processStart && readinessAt > renewAt);
  const readiness = worker.match(
    /async function assertTenantReadyForIssuance[\s\S]*?\n\}/,
  )?.[0] ?? "";
  const automaticBranch = readiness.match(
    /if \(automaticGateRenewed\) \{[\s\S]*?return;\n  \}/,
  )?.[0] ?? "";
  assert.match(automaticBranch, /dte_legal_activation|activationResult/);
  assert.doesNotMatch(automaticBranch, /dte_activation_gate_report/);
  assert.match(readiness, /gates\?\.ready !== true/);
});

test("claimed recovery reuses production_document_id instead of creating a draft", () => {
  const documentSelection = worker.match(
    /const draft = intent\.production_document_id[\s\S]*?: await service\.createDraft\(/,
  )?.[0] ?? "";
  assert.match(
    documentSelection,
    /intent\.production_document_id\s*\?\s*\{ id: intent\.production_document_id \}/,
  );
  assert.equal((documentSelection.match(/service\.createDraft\(/g) ?? []).length, 1);
  assert.ok(
    documentSelection.indexOf("intent.production_document_id") <
      documentSelection.indexOf("service.createDraft("),
  );
});

test("server preflight prefers one strict owned reservation before available folios", () => {
  const ownedAt = productionServer.indexOf("reusableOwnedPreparationFolio");
  const availableAt = productionServer.indexOf('.eq("state", "available")');
  assert.ok(ownedAt >= 0 && availableAt > ownedAt);
  assert.match(productionServer, /relation\.tenant_id === document\.tenantId/);
  assert.match(productionServer, /relation\.document_id === document\.id/);
  assert.match(productionServer, /relation\.business_operation_id === businessOperationId/);
  assert.match(productionServer, /relation\.state === "reserved"/);
  assert.match(productionServer, /relations\.length !== 1/);
  assert.match(productionServer, /document\.status === "draft"/);
  assert.match(productionServer, /\["prepared", "ready"\]\.includes/);
  assert.match(productionServer, /document\.folio === null/);
  assert.match(productionServer, /document\.cafId === null/);
  assert.match(productionServer, /relations\.length === 0/);
  assert.match(productionServer, /DTE_OWNED_FOLIO_PREFLIGHT_FAILED/);
  assert.match(productionServer, /selectedFolio < Number\(caf\.range_from\)/);
  assert.match(productionServer, /loadProductionCafForTenant/);
});

test("runtime resume without an exact target fails before any HTTP request", () => {
  const result = spawnSync(process.execPath, ["scripts/dte/run-automatic-worker-once.mjs"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      DTE_PRODUCTION_ENABLED: "true",
      DTE_AUTOMATIC_WORKER_ENABLED: "true",
      DTE_WORKER_SECRET: "x".repeat(64),
      DTE_AUTOMATIC_OWNED_FOLIO_RESUME: "true",
      DTE_AUTOMATIC_TARGET_OUTBOX_ID: "",
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /automaticDteWorker=resume_target_required/);
  assert.doesNotMatch(result.stderr, /automaticDteWorker=unavailable/);
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
