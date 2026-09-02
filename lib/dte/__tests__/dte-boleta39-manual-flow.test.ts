import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateDocumentDraftTotals,
} from "../invoice-drafts";
import {
  BOLETA_PRODUCTION_SUBMIT_URL,
  requestBoletaRestDocumentStatus,
  requestBoletaRestSubmit,
} from "../certification/boleta39-rest-api";
import {
  canonicalIntentStatusForSiiStatus,
  friendlyDteStatus,
} from "../cutover";

const source = (path: string) => readFileSync(path, "utf8");

test("BOLETA_GROSS_INPUT_SEMANTICS and BOLETA_NO_DOUBLE_IVA", () => {
  const fiveThousand = calculateDocumentDraftTotals(39, [{
    description: "Servicios WEB",
    quantity: 1,
    unitNetAmount: 5_000,
    pricingMode: "manual_net",
  }]);
  assert.deepEqual(
    {
      BOLETA_INPUT_GROSS: 5_000,
      BOLETA_NET: fiveThousand.netAmount,
      BOLETA_IVA: fiveThousand.taxAmount,
      BOLETA_TOTAL: fiveThousand.totalAmount,
      BOLETA_TOTAL_LINE: fiveThousand.lines[0].totalAmount,
      NO_DOUBLE_IVA: fiveThousand.totalAmount !== 5_950,
    },
    {
      BOLETA_INPUT_GROSS: 5_000,
      BOLETA_NET: 4_202,
      BOLETA_IVA: 798,
      BOLETA_TOTAL: 5_000,
      BOLETA_TOTAL_LINE: 5_000,
      NO_DOUBLE_IVA: true,
    },
  );

  const tenThousand = calculateDocumentDraftTotals(39, [{
    description: "Servicios WEB",
    quantity: 1,
    unitNetAmount: 10_000,
    pricingMode: "manual_net",
  }]);
  assert.deepEqual(
    [tenThousand.netAmount, tenThousand.taxAmount, tenThousand.totalAmount],
    [8_403, 1_597, 10_000],
  );

  const quantity = calculateDocumentDraftTotals(39, [{
    description: "Tres servicios",
    quantity: 3,
    unitNetAmount: 5_000,
    pricingMode: "manual_net",
  }]);
  assert.equal(quantity.lines[0].totalAmount, 15_000);
  assert.equal(quantity.totalAmount, 15_000);
  assert.equal(quantity.netAmount + quantity.taxAmount, 15_000);
});

test("FACTURA_NET_INPUT_SEMANTICS_UNCHANGED", () => {
  const factura = calculateDocumentDraftTotals(33, [{
    description: "Servicios WEB",
    quantity: 1,
    unitNetAmount: 4_202,
    pricingMode: "manual_net",
  }]);
  assert.deepEqual(
    [factura.netAmount, factura.taxAmount, factura.totalAmount],
    [4_202, 798, 5_000],
  );
});

test("BOLETA_CUSTOMER_SNAPSHOT and BOLETA_DRAFT_DOES_NOT_RESERVE_FOLIO", () => {
  const migration = source("migrations/202608100003_boleta39_freeze_commercial_customer.sql");
  const appendOnly = source("migrations/202608100004_boleta39_commercial_customer_snapshot.sql");
  const draftRoute = source("app/api/admin/invoice-drafts/route.ts");
  const issueRoute = source("app/api/admin/invoice-drafts/[id]/issue/route.ts");
  for (const field of [
    "customer_id", "customer_name", "customer_rut", "customer_email", "customer_phone",
  ]) {
    assert.match(migration, new RegExp(`'${field}'`));
    assert.match(appendOnly, new RegExp(field));
  }
  assert.match(migration, /for update/);
  assert.match(appendOnly, /before update or delete/);
  assert.match(appendOnly, /DTE_BOLETA39_CUSTOMER_SNAPSHOT_IMMUTABLE/);
  assert.match(issueRoute, /freeze_boleta39_draft_customer_snapshot/);
  assert.match(issueRoute, /finalize_dte_invoice_draft/);
  assert.doesNotMatch(draftRoute, /reserve_dte_production_folio|reserveFolio/);
});

test("BOLETA_XML_RECEIVER_CONSUMER_FINAL and BOLETA_PDF_CUSTOMER_DISPLAY", () => {
  const generator = source("lib/dte/production-boleta39.ts");
  assert.match(generator, /<RUTRecep>66666666-6<\/RUTRecep>/);
  assert.match(generator, /<RznSocRecep>Consumidor Final<\/RznSocRecep>/);
  assert.match(generator, /pdf\.text\("Cliente:"/);
  assert.match(generator, /Tipo de comprador: Consumidor final/);
  assert.match(generator, /formatRutWithDots\(input\.recipient\.rut\.trim\(\)\)/);
});

test("BOLETA_CONFIRM_RESERVES_ONE_FOLIO through the single manual worker path", () => {
  const issueRoute = source("app/api/admin/invoice-drafts/[id]/issue/route.ts");
  const pendingRoute = source("app/api/admin/dte-intents/[id]/process-manual/route.ts");
  const pendingAction = source("components/admin/dte/ManualPendingBoletaAction.tsx");
  const worker = source("lib/dte/automation/worker.ts");
  const service = source("lib/dte/production/service.ts");
  assert.match(issueRoute, /finalize_dte_invoice_draft/);
  assert.match(issueRoute, /runOneManualIssuanceWorker/);
  assert.match(issueRoute, /targetOutboxId: outboxResult\.data\.id/);
  assert.doesNotMatch(issueRoute, /reserveFolio|emitOnce/);
  assert.match(pendingRoute, /intent\.status !== "PENDING"/);
  assert.match(pendingRoute, /Number\(outbox\.network_attempts\) !== 0/);
  assert.match(pendingRoute, /targetOutboxId: outbox\.id/);
  assert.match(pendingRoute, /capture_boleta39_commercial_customer_snapshot/);
  assert.match(pendingAction, /Continuar emisión de \{props\.dteType === 39/);
  assert.match(worker, /DTE_BOLETA39_CUSTOMER_SNAPSHOT_REQUIRED/);
  assert.equal((worker.match(/await service\.prepare\(/g) ?? []).length, 1);
  assert.equal((worker.match(/await service\.emitOnce\(/g) ?? []).length, 1);
  assert.match(service, /current\.folio === null[\s\S]*await this\.repository\.reserveFolio/);
});

test("production X-Location is accepted without losing REC or Track ID", async () => {
  const fileName = "EnvioBoleta.xml";
  const trackId = "99887766";
  const result = await requestBoletaRestSubmit({
    environment: "production",
    token: "TESTTOKEN123",
    senderRut: "27164542-2",
    companyRut: "78195645-7",
    fileName,
    fileBytes: Buffer.from("<EnvioBOLETA/>", "latin1"),
    submitUrl: BOLETA_PRODUCTION_SUBMIT_URL,
    fetchImpl: async () => new Response(JSON.stringify({
      rut_emisor: "78195645-7",
      rut_envia: "27164542-2",
      trackid: trackId,
      fecha_recepcion: "2026-08-10 14:49:47",
      estado: "REC",
      file: fileName,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Location": `https://rahue.sii.cl/recursos/v1/boleta.electronica.envio/78195645-7-${trackId}`,
      },
    }),
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.data.status, "REC");
  assert.equal(result.data.trackId, trackId);
  assert.equal(
    result.responseSha256,
    createHash("sha256").update(Buffer.from(result.responseBody, "utf8")).digest("hex"),
  );
});

test("DOK is the final accepted state and document reconciliation is GET-only", async () => {
  let method = "";
  const result = await requestBoletaRestDocumentStatus({
    environment: "production",
    token: "TESTTOKEN123",
    companyRut: "78195645-7",
    dteType: 39,
    folio: 40_015,
    recipientRut: "66666666-6",
    amount: 5_000,
    issueDate: "2026-08-10",
    fetchImpl: async (_url, init) => {
      method = String(init?.method);
      return new Response(JSON.stringify({ codigo: "DOK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(method, "GET");
  assert.equal(result.data.code, "DOK");
  assert.equal(canonicalIntentStatusForSiiStatus("DOK"), "ACCEPTED");
  assert.equal(friendlyDteStatus("SUBMITTED", null, "DOK"), "Aceptada por el SII");
});

test("BOLETA_REC_DOES_NOT_RENDER_PREPARING and BOLETA_DOK_DOES_NOT_RENDER_PREPARING", () => {
  assert.equal(friendlyDteStatus("SUBMITTING", null, "REC"), "Recibido por el SII");
  assert.equal(friendlyDteStatus("SUBMITTING", null, "DOK"), "Aceptada por el SII");
  assert.equal(friendlyDteStatus("QUEUED"), "Preparando emisión");
});

test("editor keeps commercial customer separate and BOLETA_CURRENT_TRACK_ONLY", () => {
  const form = source("components/admin/dte/ManualIssuanceForm.tsx");
  const rows = source("lib/dte/admin-document-rows.ts");
  const actions = source("components/admin/dte/DteDocumentActions.tsx");
  for (const text of [
    "Cliente asociado", "Nombre", "RUT", "Correo", "Teléfono",
    "Tributariamente la Boleta 39 será emitida como Consumidor Final.",
    "Confirmar y emitir boleta",
    "Esta acción reservará un folio tributario.",
  ]) assert.match(form, new RegExp(text));
  assert.match(rows, /currentUploadTrackVerified/);
  assert.match(rows, /request_sha256 === currentEnvioSha/);
  assert.match(rows, /track_id_fingerprint === production\.track_id_fingerprint/);
  assert.match(rows, /canQuery: currentUploadTrackVerified/);
  assert.match(actions, /Consultar estado SII/);
});

test("Factura 33 confirmation dispatches the exact manual outbox without duplicate reservation or upload", () => {
  const issueRoute = source("app/api/admin/invoice-drafts/[id]/issue/route.ts");
  const pendingRoute = source("app/api/admin/dte-intents/[id]/process-manual/route.ts");
  const pendingAction = source("components/admin/dte/ManualPendingBoletaAction.tsx");
  const worker = source("lib/dte/automation/worker.ts");
  assert.match(issueRoute, /\[33, 39\]\.includes\(dteType\)/);
  assert.doesNotMatch(issueRoute, /if \(dteType === 39 && finalized\.intent_id\)/);
  assert.match(issueRoute, /targetOutboxId: outboxResult\.data\.id/);
  assert.match(pendingRoute, /\[33, 39\]\.includes\(Number\(intent\.resolved_dte_type\)\)/);
  assert.match(pendingRoute, /issuance_origin: "manual_admin"/);
  assert.match(pendingRoute, /targetOutboxId: outbox\.id/);
  assert.match(pendingAction, /Factura 33/);
  assert.equal((worker.match(/await service\.createDraft\(/g) ?? []).length, 1);
  assert.equal((worker.match(/await service\.prepare\(/g) ?? []).length, 1);
  assert.equal((worker.match(/await service\.emitOnce\(/g) ?? []).length, 1);
});

test("ambiguity persistence accepts the already-recorded single network attempt", () => {
  const worker = source("lib/dte/automation/worker.ts");
  assert.match(worker, /markAmbiguousNoRetry/);
  assert.match(worker, /network_attempt_count: 1/);
  assert.match(worker, /status: "BLOCKED"/);
  assert.match(worker, /lease_expires_at: null/);
  assert.doesNotMatch(worker, /rpc\("dte_mark_ambiguous_no_retry"/);
});

test("FACTURA_CUSTOMER_TAX_DATA_UNCHANGED", () => {
  const form = source("components/admin/dte/ManualIssuanceForm.tsx");
  for (const label of ["Razón social", "Giro", "Dirección", "Comuna", "Precio neto unitario"]) {
    assert.match(form, new RegExp(label));
  }
});
