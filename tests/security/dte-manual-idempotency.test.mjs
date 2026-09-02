import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("double confirmation cannot duplicate intent, outbox, folio or submit", () => {
  const automatic = read("migrations/202607240002_dte_automatic_issuance.sql");
  const legal = read("migrations/202607270001_dte_legal_activation.sql");
  const production = read("migrations/202607240001_dte_production_cutover.sql");
  const route = read("app/api/admin/dte-intents/manual/route.ts");

  assert.match(automatic, /unique \(tenant_id, idempotency_key\)/);
  assert.match(automatic, /unique \(tenant_id, intent_id\)/);
  assert.match(legal, /dte_manual_intent_enqueue[\s\S]*after insert/);
  assert.match(route, /\.eq\("idempotency_key", idempotencyKey\)\.maybeSingle/);
  assert.match(production, /unique \(tenant_id, business_operation_id\)/);
  assert.match(production, /unique \(tenant_id, document_id\)/);
  assert.match(production, /attempt_number integer not null default 1 check \(attempt_number = 1\)/);
});

test("all deterministic checks run before draft creation and folio preparation", () => {
  const worker = read("lib/dte/automation/worker.ts");
  const gateAt = worker.indexOf("assertTenantReadyForIssuance");
  const amountAt = worker.indexOf("DTE_AMOUNT_SNAPSHOT_INVALID");
  const createDraftAt = worker.indexOf("service.createDraft");
  const prepareAt = worker.indexOf("service.prepare");

  assert.ok(gateAt >= 0 && amountAt > gateAt);
  assert.ok(createDraftAt > amountAt);
  assert.ok(prepareAt > createDraftAt);
});

test("manual claim is tenant scoped and excludes blocked document types", () => {
  const migration = read("migrations/202607280002_dte_manual_worker_dispatch.sql");
  const worker = read("lib/dte/automation/worker.ts");
  assert.match(migration, /i\.resolved_dte_type in \(33,56,61\)/);
  assert.match(migration, /active\.tenant_id = o\.tenant_id/);
  assert.match(worker, /\.eq\("tenant_id", item\.tenant_id\)/);
  assert.doesNotMatch(migration, /resolved_dte_type in \([^)]*(34|39|41|52)/);
});
