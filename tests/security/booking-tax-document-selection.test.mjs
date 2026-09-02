import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tenantRoute = readFileSync(
  "app/api/tenants/by-slug/route.ts",
  "utf8",
);

const createRoute = readFileSync(
  "app/api/appointments/create/route.ts",
  "utf8",
);

const bookingUi = readFileSync(
  "app/reservar/page.tsx",
  "utf8",
);

test("public tenant payload exposes invoice 33 only when production readiness is complete", () => {
  assert.match(
    tenantRoute,
    /invoice_document_selection_enabled:[\s\S]*?operationalCapabilities\.publicTaxDocument/,
  );

  assert.match(
    tenantRoute,
    /dteAuthorization\.data\.authorized_types\.includes\(33\)/,
  );

  assert.match(
    tenantRoute,
    /invoiceActivation\.data\?\.status === "active"/,
  );

  assert.match(
    tenantRoute,
    /invoiceGate\.data as \{ ready\?: boolean \} \| null\)\?\.ready === true/,
  );

  assert.match(
    tenantRoute,
    /dte_activation_gate_report[\s\S]*?p_dte_type: 33/,
  );
});

test("public appointment creation fails closed for unauthorized invoice 33", () => {
  assert.match(
    createRoute,
    /\(requestedDocumentType === 33 \|\| requestedDocumentType === 39\)[\s\S]*?!operational\.capabilities\.publicTaxDocument/,
  );

  assert.match(
    createRoute,
    /!isDemoAppointment && !isAdminRequest && requestedDocumentType === 33/,
  );

  assert.match(
    createRoute,
    /authorization\.authorized_types\.includes\(33\)/,
  );

  assert.match(
    createRoute,
    /activation\?\.status === "active"/,
  );

  assert.match(
    createRoute,
    /invoiceGate\.data as \{ ready\?: boolean \} \| null\)\?\.ready === true/,
  );

  assert.match(
    createRoute,
    /La factura electrónica no está disponible para este prestador/,
  );
});

test("existing public boleta 39 server gate remains intact", () => {
  assert.match(
    createRoute,
    /if \(!isDemoAppointment && !isAdminRequest && requestedDocumentType === 39\) \{[\s\S]*?dte_tenant_document_capabilities/,
  );

  assert.match(
    createRoute,
    /customer_selection_enabled[\s\S]*?issuance_enabled[\s\S]*?certification_status/,
  );
});

test("demo shows separate simulated boleta and factura choices", () => {
  assert.match(
    bookingUi,
    /demoTaxDocumentType.*useState<33 \| 39 \| null>\(null\)/,
  );

  assert.match(
    bookingUi,
    /setDemoTaxDocumentType\(39\)/,
  );

  assert.match(
    bookingUi,
    /Boleta electrónica — simulación/,
  );

  assert.match(
    bookingUi,
    /setDemoTaxDocumentType\(33\)/,
  );

  assert.match(
    bookingUi,
    /Factura electrónica — simulación/,
  );
});

test("safe demo never sends a real 33 or 39 tax document selection", () => {
  assert.match(
    bookingUi,
    /const productiveTaxDocumentType = isSafeDemoAppointment\s*\?\s*null\s*:\s*taxDocumentType/,
  );

  assert.match(
    bookingUi,
    /taxDocumentType: productiveTaxDocumentType/,
  );

  assert.match(
    bookingUi,
    /invoiceRequested: isSafeDemoAppointment \? false : invoiceRequested/,
  );
});

test("production UI gates invoice and boleta independently", () => {
  assert.match(
    bookingUi,
    /setInvoiceSelectionEnabled\(\s*tenant\.invoice_document_selection_enabled === true/,
  );

  assert.match(
    bookingUi,
    /disabled=\{saving \|\| !tenantId \|\| !invoiceSelectionEnabled\}/,
  );

  assert.match(
    bookingUi,
    /disabled=\{saving \|\| !tenantId \|\| !boletaSelectionEnabled\}/,
  );
});

test("invoice tax profile keeps the complete canonical receiver data", () => {
  assert.match(
    createRoute,
    /from\("customer_tax_profiles"\)\.upsert/,
  );

  for (const field of [
    "rut_normalized",
    "legal_name",
    "business_activity",
    "tax_address",
    "tax_commune",
    "tax_city",
    "tax_email",
  ]) {
    assert.match(createRoute, new RegExp(field));
  }
});
