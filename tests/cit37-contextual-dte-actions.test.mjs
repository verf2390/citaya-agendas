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

test("CIT-37 resolves appointment DTE context from persisted billing relations", () => {
  assert.match(contextSource, /from\("billing_sale_appointments"\)/);
  assert.match(contextSource, /from\("billing_sales"\)/);
  assert.match(contextSource, /from\("billing_sale_payments"\)/);
  assert.match(contextSource, /from\("dte_payment_document_intents"\)/);
  assert.match(contextSource, /from\("billing_sale_item_document_coverage"\)/);
  assert.match(contextSource, /from\("dte_invoice_drafts"\)/);
  assert.match(contextSource, /from\("dte_production_documents"\)/);
  assert.match(contextSource, /\.eq\("tenant_id", tenantId\)/);
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
    /if \(input\.requestedDocumentType\)[\s\S]*canRequestBoleta: false,[\s\S]*canRequestFactura: false/,
  );
  assert.match(
    contextSource,
    /paymentState[\s\S]*PAID[\s\S]*canRequestBoleta: false,[\s\S]*canRequestFactura: false/,
  );
});

test("CIT-37 final intent state wins over an intermediate SII label", () => {
  assert.match(contextSource, /FINAL_INTENT_STATES/);
  assert.match(
    contextSource,
    /FINAL_INTENT_STATES\.has\(normalizedIntent\)[\s\S]*friendlyDteStatus\([\s\S]*normalizedIntent,[\s\S]*input\.blockingReason \?\? null,[\s\S]*null/,
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
  assert.doesNotMatch(routeSource, /issue|reserve_folio|submit/i);
});

test("CIT-37 bulk endpoint accepts only UUID appointment ids and caps the batch", () => {
  assert.match(routeSource, /filter\(\(value: string\) => isUuid\(value\)\)/);
  assert.match(routeSource, /\.slice\(0, 200\)/);
  assert.match(routeSource, /Cache-Control/);
  assert.match(routeSource, /no-store/);
});
