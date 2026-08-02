import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("manual editor and persistence share one server-side pricing contract", () => {
  const route = read("app/api/admin/dte-intents/manual/route.ts");
  const form = read("components/admin/dte/ManualIssuanceForm.tsx");
  const money = read("lib/dte/manual-money.ts");

  assert.match(form, /Precio final unitario \(IVA incluido\)/);
  assert.match(form, /unitGrossAmount/);
  assert.match(form, /Revisar y emitir/);
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
  assert.match(service, /EnvironmentFile=\/home\/verf\/apps\/citaya-agendas\/\.env\.local/);
  assert.match(service, /User=verf/);
  assert.match(service, /WorkingDirectory=\/home\/verf\/apps\/citaya-agendas/);
  assert.match(service, /node\/v20\.20\.0\/bin\/node/);
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

test("billing refresh updates documents incrementally without full reload", () => {
  const form = read("components/admin/dte/ManualIssuanceForm.tsx");
  const page = read("app/admin/facturacion/page.tsx");
  const endpoint = read("app/api/admin/dte-settings/documents/route.ts");
  const source = `${form}\n${page}`;

  assert.doesNotMatch(source, /(?:window\.)?location\.reload/);
  assert.doesNotMatch(source, /router\.refresh/);
  assert.match(page, /refreshDocuments/);
  assert.match(page, /\/api\/admin\/dte-settings\/documents/);
  assert.match(page, /setState\(\(current\)/);
  assert.match(page, /onCreated=\{\(\) => void refreshDocuments\(\)\}/);
  assert.match(endpoint, /requireHostTenantAdmin/);
  assert.match(page, /Total IVA incluido/);

  const rows = read("lib/dte/admin-document-rows.ts");
  const actions = read("components/admin/dte/DteDocumentActions.tsx");
  assert.match(rows, /dte_production_artifacts/);
  assert.match(rows, /track_id_fingerprint/);
  assert.match(rows, /canDownloadXml: Boolean\(input\.productionDocumentId && hasDteXml\)/);
  assert.match(rows, /canDownloadPdf: Boolean\(input\.productionDocumentId && hasPdf\)/);
  assert.match(rows, /canEmail: Boolean\(input\.productionDocumentId && deliverable && hasDteXml && hasPdf\)/);
  assert.match(actions, /disabled=\{!props\.canViewTrackId \|\| Boolean\(busy\)\}/);
  assert.match(actions, /disabled=\{!props\.canDownloadXml \|\| Boolean\(busy\)\}/);
  assert.match(actions, /disabled=\{!props\.canDownloadPdf \|\| Boolean\(busy\)\}/);
  assert.match(actions, /disabled=\{!props\.canEmail \|\| Boolean\(busy\)\}/);
});

test("folio RPC is qualified and exact recovery is single-use fail-closed", () => {
  const migration = read("migrations/202607290001_dte_manual_first_invoice_recovery.sql");
  assert.match(migration, /ledger\.folio = selected\.folio/);
  assert.match(migration, /order by ledger\.folio/);
  assert.match(migration, /claimed\.status <> 'BLOCKED'/);
  assert.match(migration, /claimed\.deterministic_attempts <> 1/);
  assert.match(migration, /claimed\.network_attempts <> 0/);
  assert.match(migration, /document\.folio is null/);
  assert.match(migration, /dte_production_submission_attempts/);
  assert.match(migration, /MANUAL_ISSUANCE_RETRY_AUTHORIZED/);
  assert.doesNotMatch(migration, /status\s*=\s*'CANCELED'/);
});

test("controlled XSD resume is single-use and preserves the exact existing folio", () => {
  const migration = read("migrations/202607290002_dte_manual_xsd_resume.sql");
  const worker = read("lib/dte/automation/worker.ts");
  assert.match(worker, /dte_claim_manual_xsd_resume_exact/);
  assert.match(migration, /claimed\.deterministic_attempts <> 2/);
  assert.match(migration, /claimed\.network_attempts <> 0/);
  assert.match(migration, /claimed\.last_safe_error <> 'XSD'/);
  assert.match(migration, /document_row\.status <> 'prepared'/);
  assert.match(migration, /document_row\.folio <> p_expected_folio/);
  assert.match(migration, /ledger_row\.state <> 'reserved'/);
  assert.match(migration, /ledger_row\.document_id <> document_row\.id/);
  assert.match(migration, /dte_production_artifacts/);
  assert.match(migration, /dte_production_submission_attempts/);
  assert.match(migration, /additionalFolioReserved', false/);
  assert.match(migration, /MANUAL_ISSUANCE_XSD_RESUME_AUTHORIZED/);
  assert.doesNotMatch(migration, /state\s*=\s*'available'/);
  assert.doesNotMatch(migration, /reserve_dte_production_folio/);
  assert.doesNotMatch(migration, /status\s*=\s*'CANCELED'/);
});

test("rg-spa ACTECO evidence is exact, audited and leaves issuance ownership untouched", () => {
  const migration = read("migrations/202607290003_rg_issuer_activity_code.sql");
  assert.match(migration, /where tenant\.slug = 'rg-spa'/);
  assert.match(migration, /issuer_activity_code = '620900'/);
  assert.match(migration, /'activityCode', '620900'/);
  assert.match(migration, /'effectiveDate', '2026-04-27'/);
  assert.match(migration, /'vatAffected', true/);
  assert.match(migration, /issuer_activity_code_evidence_recorded/);
  assert.match(migration, /dte_production_audit/);
  assert.match(migration, /document\.folio = 8/);
  assert.match(migration, /ledger\.state = 'reserved'/);
  assert.match(migration, /ledger\.document_id = document\.id/);
  assert.match(migration, /dte_production_artifacts/);
  assert.match(migration, /dte_production_submission_attempts/);
  assert.doesNotMatch(migration, /479100/);
  assert.doesNotMatch(
    migration,
    /update public\.dte_(?:payment_document_intents|issuance_outbox|production_folio_ledger)/,
  );
});

test("automatic payment enqueue stays blocked when automation is disabled", () => {
  const automaticMigration = read("migrations/202607240002_dte_automatic_issuance.sql");
  assert.match(
    automaticMigration,
    /cfg\.issuance_mode <> 'automatic_on_verified_payment' then block_reason := 'AUTOMATION_DISABLED'/,
  );
});
