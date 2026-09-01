import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contextSource = readFileSync(
  "lib/dte/admin-appointment-document-context.ts",
  "utf8",
);
const routeSource = readFileSync(
  "app/api/admin/dte-context/appointments/route.ts",
  "utf8",
);
const paymentsSource = readFileSync("app/admin/pagos/page.tsx", "utf8");
const paymentCellSource = readFileSync(
  "components/admin/dte/PaymentDocumentCell.tsx",
  "utf8",
);
const manualFormSource = readFileSync(
  "components/admin/dte/ManualIssuanceForm.tsx",
  "utf8",
);
const draftRouteSource = readFileSync(
  "app/api/admin/invoice-drafts/route.ts",
  "utf8",
);
const cutoverSource = readFileSync("lib/dte/cutover.ts", "utf8");

test("CIT-37 resolves appointment DTE context from persisted billing relations", () => {
  assert.match(contextSource, /from\("billing_sale_appointments"\)/);
  assert.match(contextSource, /from\("billing_sales"\)/);
  assert.match(contextSource, /from\("billing_sale_payments"\)/);
  assert.match(contextSource, /from\("dte_payment_document_intents"\)/);
  assert.match(contextSource, /from\("billing_sale_item_document_coverage"\)/);
  assert.match(contextSource, /from\("dte_invoice_drafts"\)/);
  assert.match(contextSource, /from\("dte_production_documents"\)/);
  assert.match(contextSource, /\.eq\("tenant_id", tenantId\)/);
  assert.match(contextSource, /intent_id/);
  assert.match(contextSource, /draftIntentIdSet/);
  assert.match(contextSource, /\.in\("sale_id", saleIds\)/);
  assert.match(contextSource, /draftsBySale/);
});

test("CIT-37 blocks duplicate contextual issuance paths", () => {
  assert.match(
    contextSource,
    /if \(input\.hasIntent\)[\s\S]*canRequestBoleta: false,[\s\S]*canRequestFactura: false/,
  );
  assert.match(
    contextSource,
    /if \(input\.hasActiveDraft\)[\s\S]*canRequestBoleta: false,[\s\S]*canRequestFactura: false/,
  );
  assert.match(
    contextSource,
    /if \(input\.hasActiveCoverage\)[\s\S]*canRequestBoleta: false,[\s\S]*canRequestFactura: false/,
  );
  assert.match(
    contextSource,
    /if \(input\.requestedDocumentType === 33\)[\s\S]*canRequestBoleta: false,[\s\S]*canRequestFactura: true/,
  );
  assert.match(
    contextSource,
    /if \(input\.requestedDocumentType === 39\)[\s\S]*canRequestBoleta: true,[\s\S]*canRequestFactura: false/,
  );
  assert.match(
    contextSource,
    /paymentState[\s\S]*PAID[\s\S]*canRequestBoleta: false,[\s\S]*canRequestFactura: false/,
  );
});

test("CIT-37 final intent state wins over an intermediate SII label", () => {
  const acceptedIndex = cutoverSource.indexOf(
    'if (normalized === "ACCEPTED") return "Aceptada por el SII";',
  );
  const intermediateIndex = cutoverSource.indexOf(
    '["sent", "rec", "processing", "pdr"].includes(normalizedSiiStatus)',
  );
  assert.ok(acceptedIndex > -1);
  assert.ok(intermediateIndex > acceptedIndex);
  assert.match(
    cutoverSource,
    /canonicalSiiStatus === "ACCEPTED"[\s\S]*Aceptada por el SII/,
  );
});

test("CIT-37 context endpoint is host-tenant admin scoped and read-only", () => {
  assert.match(routeSource, /requireHostTenantAdmin\(req\)/);
  assert.match(routeSource, /loadAdminAppointmentDocumentContexts/);
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /export async function POST/);
  assert.doesNotMatch(routeSource, /\.insert\(/);
  assert.doesNotMatch(routeSource, /\.update\(/);
  assert.doesNotMatch(routeSource, /\.upsert\(/);
  assert.doesNotMatch(routeSource, /reserve_folio|submit/i);
});

test("CIT-37 bulk endpoint accepts only UUID appointment ids and caps the batch", () => {
  assert.match(routeSource, /filter\(\(value: string\) => isUuid\(value\)\)/);
  assert.match(routeSource, /\.slice\(0, 200\)/);
  assert.match(routeSource, /Cache-Control/);
  assert.match(routeSource, /no-store/);
});

test("CIT-37 payments renders canonical contextual state instead of unconditional actions", () => {
  assert.match(paymentsSource, /PaymentDocumentCell/);
  assert.match(paymentsSource, /<PaymentDocumentCell appointmentId=\{row\.id\} \/>/);
  assert.doesNotMatch(
    paymentsSource,
    /<StatusBadge label="Sin documento" tone="slate" \/>[\s\S]*Solicitar boleta[\s\S]*Solicitar factura/,
  );
  assert.match(paymentCellSource, /\/api\/admin\/dte-context\/appointments/);
  assert.match(paymentCellSource, /JSON\.stringify\(\{ appointmentIds \}\)/);
  assert.match(paymentCellSource, /context\.intent\.displayStatus/);
  assert.match(paymentCellSource, /context\.canRequestBoleta/);
  assert.match(paymentCellSource, /context\.canRequestFactura/);
  assert.match(paymentCellSource, /Consultando documento/);
  assert.match(paymentCellSource, /Estado no disponible/);
});

test("CIT-37 refreshes the cached DTE context after a successful manual payment", () => {
  const markAsPaidStart = paymentsSource.indexOf("const markAsPaid = async");
  const markAsPaidEnd = paymentsSource.indexOf(
    "const copyPaymentLink = async",
    markAsPaidStart,
  );
  const markAsPaidSource = paymentsSource.slice(markAsPaidStart, markAsPaidEnd);

  assert.match(
    paymentsSource,
    /import PaymentDocumentCell, \{[\s\S]*refreshAppointmentDocumentContext,[\s\S]*\} from "@\/components\/admin\/dte\/PaymentDocumentCell"/,
  );
  assert.match(
    markAsPaidSource,
    /if \(!res\.ok \|\| !json\?\.ok\)[\s\S]*return;[\s\S]*refreshAppointmentDocumentContext\(appointmentId\);[\s\S]*await loadRows\(\)/,
  );
  assert.match(
    paymentCellSource,
    /export function refreshAppointmentDocumentContext\(appointmentId: string\)[\s\S]*contextCache\.delete\(appointmentId\)[\s\S]*unavailableIds\.delete\(appointmentId\)[\s\S]*publish\(appointmentId, \{ kind: "loading" \}\)[\s\S]*queueContextLoad\(appointmentId\)/,
  );
  assert.match(
    paymentCellSource,
    /function subscribe[\s\S]*set\.add\(listener\)[\s\S]*listeners\.set\(appointmentId, set\)/,
  );
  assert.match(
    paymentCellSource,
    /contextVersions\.get\(context\.appointmentId\)[\s\S]*requestedVersions\.get\(context\.appointmentId\)/,
  );
});

test("CIT-37 contextual editor validates appointment and dte type before prefilling", () => {
  assert.match(manualFormSource, /params\.get\("appointmentId"\)/);
  assert.match(manualFormSource, /params\.get\("dteType"\)/);
  assert.match(manualFormSource, /\/api\/admin\/dte-context\/appointments\?appointmentId=/);
  assert.match(manualFormSource, /context\.customerId/);
  assert.match(manualFormSource, /context\.totalAmount/);
  assert.match(manualFormSource, /context\.canRequestBoleta/);
  assert.match(manualFormSource, /context\.canRequestFactura/);
  assert.match(manualFormSource, /setSource\("appointment"\)/);
  assert.match(manualFormSource, /setAppointmentId\(requestedAppointmentId\)/);
  assert.match(manualFormSource, /todavía no se emitió ningún documento/);
  assert.doesNotMatch(
    manualFormSource,
    /requestedAppointmentId[\s\S]{0,300}\/issue/,
  );
});

test("CIT-37 draft POST rejects browser-mismatched billing data before insert", () => {
  const contextIndex = draftRouteSource.indexOf(
    "loadAdminAppointmentDocumentContexts(",
  );
  const insertIndex = draftRouteSource.indexOf(
    '.from("dte_invoice_drafts")',
    contextIndex,
  );
  assert.ok(contextIndex > -1);
  assert.ok(insertIndex > contextIndex);
  const guarded = draftRouteSource.slice(contextIndex, insertIndex);
  assert.match(guarded, /context\.customerId !== customerId/);
  assert.match(guarded, /if \(context\.intent\)/);
  assert.match(guarded, /if \(context\.activeDraft\)/);
  assert.match(guarded, /if \(context\.hasActiveCoverage\)/);
  assert.match(
    guarded,
    /context\.requestedDocumentType !== dteType/,
  );
  assert.match(guarded, /context\.paymentState[\s\S]*PAID/);
  assert.match(
    guarded,
    /context\.totalAmount[\s\S]*totals\.totalAmount/,
  );
  assert.match(guarded, /canonicalSaleId = context\.saleId/);
  assert.match(draftRouteSource, /sale_id: canonicalSaleId/);
  assert.doesNotMatch(draftRouteSource, /body\?\.saleId|body\.saleId/);
});

test("CIT-37 keeps standalone manual issuance path available", () => {
  assert.match(draftRouteSource, /source !== "manual"/);
  assert.match(manualFormSource, /value="manual">Venta manual/);
  assert.match(manualFormSource, /Concepto manual/);
});

test("CIT-37 makes the contextual canSave gate explicit", () => {
  assert.match(
    manualFormSource,
    /const contextualSeedReady =\s*!contextLocked \|\| \(Boolean\(appointmentId\) && source === "appointment"\);/,
  );
  assert.match(
    manualFormSource,
    /const canSave =\s*contextualSeedReady &&\s*Boolean\(customerId\) &&\s*lines\.length > 0 &&\s*lines\.every/,
  );
  assert.doesNotMatch(
    manualFormSource,
    /!contextLocked \|\| Boolean\(appointmentId\) && source === "appointment"\s*\?/,
  );
});
