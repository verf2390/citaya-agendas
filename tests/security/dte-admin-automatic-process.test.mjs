import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const route = read("app/api/admin/dte-intents/[id]/process-automatic/route.ts");
const action = read("components/admin/dte/AutomaticPendingDteAction.tsx");
const rows = read("lib/dte/admin-document-rows.ts");
const page = read("app/admin/facturacion/page.tsx");

test("automatic admin endpoint authenticates and scopes intent and outbox to the host tenant", () => {
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /requireHostTenantAdmin\(req\)/);
  assert.ok(
    route.indexOf("requireHostTenantAdmin(req)") <
      route.indexOf('from("dte_payment_document_intents")'),
  );
  assert.equal((route.match(/\.eq\("tenant_id", auth\.tenantId\)/g) ?? []).length, 3);
  assert.match(route, /confirmation \?\? ""\) !== `EJECUTAR \$\{id\}`/);
  assert.match(route, /DTE_PRODUCTION_ENABLED !== "true"/);
  assert.match(route, /DTE_AUTOMATIC_WORKER_ENABLED !== "true"/);
});

test("automatic admin endpoint rejects manual or ineligible intent and outbox domains", () => {
  for (const invariant of [
    /intent\.status !== "PENDING"/,
    /\!\[33, 39\]\.includes\(Number\(intent\.resolved_dte_type\)\)/,
    /intent\.origin !== "automatic_payment"/,
    /intent\.production_document_id !== null/,
    /Number\(intent\.network_attempt_count\) !== 0/,
    /outbox\.status !== "PENDING"/,
    /outbox\.issuance_origin !== "automatic_system"/,
    /Number\(outbox\.network_attempts\) !== 0/,
    /outbox\.locked_at !== null/,
  ]) assert.match(route, invariant);
  for (const trigger of ["khipu", "webpay", "mercadopago", "manual_verified"]) {
    assert.match(route, new RegExp(`"${trigger}"`));
  }
  assert.doesNotMatch(route, /runOneManualIssuanceWorker|targetOutboxId:/);
});

test("DTE39 requires its tenant snapshot before the exact automatic worker call", () => {
  const snapshotIndex = route.indexOf('from("dte_boleta39_commercial_customer_snapshots")');
  const workerIndex = route.indexOf("runOneAutomaticIssuanceWorker({");
  assert.ok(snapshotIndex > 0);
  assert.ok(workerIndex > snapshotIndex);
  assert.match(route, /snapshotResult\.error \|\| !snapshotResult\.data/);
  assert.match(route, /automaticTargetOutboxId: outbox\.id/);
  assert.equal((route.match(/runOneAutomaticIssuanceWorker\(/g) ?? []).length, 1);
  assert.doesNotMatch(route, /runOneAutomaticIssuanceWorker\(\s*\{\s*\}\s*\)/);
  assert.doesNotMatch(route, /\/api\/internal\/dte-worker/);
});

test("automatic recovery component confirms the exact intent without worker secrets or double submit", () => {
  assert.match(action, /Ejecutar DTE automático/);
  assert.match(action, /procesará exactamente esta/);
  assert.match(action, /puede consumir un folio tributario y enviar el documento al SII/);
  assert.match(action, /\/api\/admin\/dte-intents\/\$\{props\.intentId\}\/process-automatic/);
  assert.match(action, /confirmation: `EJECUTAR \$\{props\.intentId\}`/);
  assert.match(action, /if \(busy \|\| locked\) return/);
  assert.match(action, /disabled=\{busy \|\| locked\}/);
  assert.match(action, /props\.onProcessed\(\)/);
  assert.doesNotMatch(`${action}\n${page}`, /DTE_WORKER_SECRET/);
});

test("normal automatic pending rows show processing state without a manual CTA", () => {
  const automaticBlock = rows.match(
    /const isAutomaticProcessing =[\s\S]*?\[33, 39\]\.includes\(Number\(row\.resolved_dte_type\)\)/,
  )?.[0] ?? "";
  const manualBlock = rows.match(
    /canProcessManual:[\s\S]*?\[33, 39\]\.includes\(Number\(row\.resolved_dte_type\)\)/,
  )?.[0] ?? "";
  assert.match(automaticBlock, /!row\.production_document_id/);
  assert.match(automaticBlock, /row\.status === "PENDING"/);
  assert.match(automaticBlock, /row\.origin === "automatic_payment"/);
  for (const trigger of ["khipu", "webpay", "mercadopago", "manual_verified"]) {
    assert.match(automaticBlock, new RegExp(`"${trigger}"`));
  }
  assert.doesNotMatch(automaticBlock, /manual_admin/);
  assert.match(manualBlock, /row\.trigger_source === "manual_admin"/);
  assert.doesNotMatch(manualBlock, /automatic_payment/);
  assert.match(rows, /origin,receiver_snapshot/);
  assert.equal((rows.match(/canProcessAutomatic: false/g) ?? []).length, 2);
  assert.equal((page.match(/document\.isAutomaticProcessing/g) ?? []).length, 2);
  assert.equal((page.match(/Procesando automáticamente…/g) ?? []).length, 2);
  assert.doesNotMatch(page, /AutomaticPendingDteAction/);
  assert.doesNotMatch(page, /document\.canProcessAutomatic/);
  assert.doesNotMatch(page, /Ejecutar DTE automático/);
});
