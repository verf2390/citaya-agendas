import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("manual preview and persistence share one gross server-side contract", () => {
  const route = read("app/api/admin/dte-intents/manual/route.ts");
  const form = read("components/admin/dte/ManualIssuanceForm.tsx");
  const money = read("lib/dte/manual-money.ts");

  assert.match(form, /Precio final IVA incluido/);
  assert.match(form, /unitGrossAmount/);
  assert.match(form, /Confirmar y emitir factura real/);
  assert.match(route, /previewOnly/);
  assert.match(route, /reviewFingerprint/);
  assert.match(route, /calculateManualMoney/);
  assert.match(route, /amount_snapshot: money\.grossAmount/);
  assert.match(route, /immutable_snapshot: snapshot/);
  assert.doesNotMatch(route, /body\?\.(netAmount|taxAmount|grossAmount)/);
  assert.match(money, /Math\.round\(grossAmount \/ 1\.19\)/);
});

test("manual worker is durable, leased, manual-only and never retries terminal rows", () => {
  const migration = read("migrations/202607280002_dte_manual_worker_dispatch.sql");
  const worker = read("lib/dte/automation/worker.ts");
  const service = read("ops/systemd/citaya-dte-manual-worker.service");
  const timer = read("ops/systemd/citaya-dte-manual-worker.timer");

  assert.match(migration, /dte_claim_manual_issuance_outbox/);
  assert.match(migration, /i\.trigger_source = 'manual_admin'/);
  assert.match(migration, /i\.status = 'PENDING'/);
  assert.match(migration, /o\.status = 'PENDING'/);
  assert.match(migration, /cfg\.production_enabled = true/);
  assert.doesNotMatch(migration, /cfg\.issuance_mode = 'automatic_on_verified_payment'/);
  assert.match(migration, /for update of o skip locked/);
  assert.match(migration, /lease_expires_at/);
  assert.match(migration, /WORKER_LEASE_EXPIRED_EXPLICIT_RETRY_REQUIRED/);
  assert.match(migration, /automaticRetry', false/);
  assert.match(worker, /dte_claim_manual_issuance_outbox/);
  assert.match(worker, /networkAttempts: 1/);
  assert.match(service, /Type=oneshot/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /OnUnitActiveSec=15s/);
});

test("UI exposes pending, processing, failed, sent and accepted states", () => {
  const statusRoute = read("app/api/admin/dte-intents/[id]/route.ts");
  const form = read("components/admin/dte/ManualIssuanceForm.tsx");
  const page = read("app/admin/facturacion/page.tsx");
  const labels = read("lib/dte/cutover.ts");

  for (const state of ["pending", "processing", "failed", "sent", "accepted"]) {
    assert.match(`${statusRoute}\n${form}`, new RegExp(`"${state}"`));
  }
  assert.match(page, /Total IVA incluido/);
  assert.match(labels, /Pendiente de procesamiento/);
  assert.match(labels, /Procesando emisión/);
  assert.match(labels, /Enviado al SII/);
});

test("automatic payment enqueue stays blocked when automation is disabled", () => {
  const automaticMigration = read("migrations/202607240002_dte_automatic_issuance.sql");
  assert.match(
    automaticMigration,
    /cfg\.issuance_mode <> 'automatic_on_verified_payment' then block_reason := 'AUTOMATION_DISABLED'/,
  );
});
