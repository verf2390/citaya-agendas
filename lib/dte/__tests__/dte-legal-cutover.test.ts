import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activationGateResult,
  canEmailDte,
  friendlyDteStatus,
  manualIssuanceIdempotencyMaterial,
  normalizeRequiredCustomerRut,
  normalizeTaxProfile,
  resolveBookingTaxDocumentType,
  validateBookingTaxInput,
  validateStandaloneLines,
  type ActivationGates,
} from "../cutover";

const validProfile = {
  rut: "76.543.210-3",
  legalName: "Cliente Prueba SpA",
  businessActivity: "Servicios profesionales",
  address: "Calle Prueba 123",
  commune: "Santiago",
  city: "Santiago",
  taxEmail: "facturacion@example.test",
};

test("admin tax document selection defaults to 39 and explicit selection wins", () => {
  const base = { isAdminRequest: true, isDemoAppointment: false };
  assert.equal(resolveBookingTaxDocumentType(base), 39);
  assert.equal(resolveBookingTaxDocumentType({
    ...base,
    taxDocumentType: 39,
    invoiceRequested: true,
  }), 39);
  assert.equal(resolveBookingTaxDocumentType({
    ...base,
    taxDocumentType: 33,
    invoiceRequested: false,
  }), 33);
});

test("public and demo tax document selection keep their existing semantics", () => {
  assert.equal(resolveBookingTaxDocumentType({
    isAdminRequest: false,
    isDemoAppointment: false,
  }), null);
  assert.equal(resolveBookingTaxDocumentType({
    isAdminRequest: false,
    isDemoAppointment: false,
    invoiceRequested: true,
  }), 33);
  assert.equal(resolveBookingTaxDocumentType({
    isAdminRequest: true,
    isDemoAppointment: true,
    taxDocumentType: 33,
    invoiceRequested: true,
  }), null);
});

test("customer RUT is required, validates DV and normalizes consistently", () => {
  assert.throws(() => normalizeRequiredCustomerRut(""), /CUSTOMER_RUT_INVALID/);
  assert.throws(() => normalizeRequiredCustomerRut("12.345.678-9"), /CUSTOMER_RUT_INVALID/);
  assert.equal(normalizeRequiredCustomerRut("76.543.210-3"), "76543210-3");
  assert.equal(normalizeRequiredCustomerRut("765432103"), "76543210-3");
});

test("historical customers may remain readable but every new booking needs RUT", () => {
  const historical = { id: "legacy", rut_normalized: null };
  assert.equal(historical.rut_normalized, null);
  assert.throws(
    () => validateBookingTaxInput({ customerRut: historical.rut_normalized, invoiceRequested: false }),
    /CUSTOMER_RUT_INVALID/,
  );
});

test("booking without invoice resolves to boleta 39 intent, never factura", () => {
  const result = validateBookingTaxInput({
    customerRut: "76.543.210-3",
    invoiceRequested: false,
  });
  assert.equal(result.requestedDocumentType, 39);
  assert.equal(result.taxProfile, null);
});

test("invoice requires every receiver tax field and accepts a valid profile", () => {
  assert.throws(
    () => validateBookingTaxInput({
      customerRut: "76.543.210-3",
      invoiceRequested: true,
      taxProfile: { ...validProfile, commune: "" },
    }),
    /CUSTOMER_TAX_PROFILE_INCOMPLETE/,
  );
  const result = validateBookingTaxInput({
    customerRut: "76.543.210-3",
    invoiceRequested: true,
    taxProfile: validProfile,
  });
  assert.equal(result.requestedDocumentType, 33);
  assert.deepEqual(result.taxProfile, {
    ...validProfile,
    rut: "76543210-3",
  });
});

test("tax profile rejects invalid RUT and email", () => {
  assert.throws(() => normalizeTaxProfile({ ...validProfile, rut: "1-8" }), /CUSTOMER_RUT_INVALID/);
  assert.throws(() => normalizeTaxProfile({ ...validProfile, taxEmail: "invalid" }), /CUSTOMER_TAX_PROFILE_INCOMPLETE/);
});

test("standalone issuance validates detail, quantity and price", () => {
  assert.throws(() => validateStandaloneLines([]), /DTE_LINES_INVALID/);
  assert.throws(
    () => validateStandaloneLines([{ description: "Servicio", quantity: 1, unitPrice: -1 }]),
    /DTE_LINES_INVALID/,
  );
  assert.deepEqual(
    validateStandaloneLines([{ description: "  Servicio mensual  ", quantity: 2, unitPrice: 10_000 }]),
    [{ description: "Servicio mensual", quantity: 2, unitPrice: 10_000 }],
  );
});

test("manual double click material is stable and tenant scoped", () => {
  const base = {
    tenantId: "tenant-a",
    key: "idempotency-key",
    appointmentId: "appointment-a",
    paymentIntentId: "payment-a",
    customerId: "customer-a",
    dteType: 33,
  };
  assert.equal(manualIssuanceIdempotencyMaterial(base), manualIssuanceIdempotencyMaterial(base));
  assert.notEqual(
    manualIssuanceIdempotencyMaterial(base),
    manualIssuanceIdempotencyMaterial({ ...base, tenantId: "tenant-b" }),
  );
});

test("all activation gates are fail closed", () => {
  const allGreen: ActivationGates = {
    issuerDataExact: true,
    issuerLegalNameMatch: true,
    issuerResolutionConfigured: true,
    typeAuthorized: true,
    certificateCurrent: true,
    certificateKeyMatch: true,
    certificateRutMatch: true,
    officialTrustAnchor: true,
    authenticTypeCaf: true,
    foliosAvailable: true,
    tenantAwareLedger: true,
    privateStorage: true,
    productionEndpoints: true,
    officialXsd: true,
    xmlDsig: true,
    workerConfigured: true,
    migrationsApplied: true,
    offlinePreflightComplete: true,
    documentEngineReady: true,
    globalFeatureEnabled: true,
  };
  assert.deepEqual(activationGateResult(allGreen), { ready: true, missing: [] });
  const blocked = activationGateResult({ ...allGreen, officialTrustAnchor: false });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.missing, ["officialTrustAnchor"]);
});

test("boleta authorization and delivery statuses are explicit and safe", () => {
  assert.equal(friendlyDteStatus("BLOCKED", "DOCUMENT_TYPE_NOT_AUTHORIZED"), "Boleta no autorizada");
  assert.equal(friendlyDteStatus("AMBIGUOUS"), "Error de envío");
  assert.equal(canEmailDte("SUBMITTED"), false);
  assert.equal(canEmailDte("AMBIGUOUS"), false);
  assert.equal(canEmailDte("ACCEPTED"), true);
  assert.equal(canEmailDte("ACCEPTED_WITH_OBJECTIONS"), true);
});

test("migration persists immutable snapshots, evidence, idempotency and reversible activation", () => {
  const sql = readFileSync("migrations/202607270001_dte_legal_activation.sql", "utf8");
  for (const expected of [
    "customer_tax_profiles",
    "customers_tenant_rut_unique",
    "dte_intent_snapshot_immutable",
    "immutable_snapshot",
    "dte_sii_authorization_evidence",
    "public\\.is_platform_admin\\(p_actor_id\\)",
    "dte_one_primary_per_verified_payment",
    "dte_activate_legal_issuance",
    "DTE_ACTIVATION_GATES_INCOMPLETE",
    "dte_pause_legal_issuance",
    "dte_legal_activation_events_append_only",
    "enable row level security",
  ]) assert.match(sql, new RegExp(expected));
  assert.doesNotMatch(sql, /insert into public\.dte_sii_authorization_evidence[\s\S]*781956457/i);
  assert.doesNotMatch(sql, /delete from|truncate|drop table/i);
});

test("manual API revalidates associated resources and server-side amounts", () => {
  const route = readFileSync("app/api/admin/dte-intents/manual/route.ts", "utf8");
  assert.match(route, /requireHostTenantAdmin/);
  assert.match(route, /\.eq\("tenant_id", auth\.tenantId\)/);
  assert.match(route, /\.eq\("customer_id", customerId\)/);
  assert.match(route, /\.eq\("status", "succeeded"\)/);
  assert.match(route, /dte_activation_gate_report/);
  assert.match(route, /verifiedPayment\?\.amount[\s\S]*appointment\?\.payment_paid_amount/);
  assert.doesNotMatch(route, /body\?\.(amount|tenantId|total)/);
});

test("executive UI has terminal loaders, retry and the requested simple sections", () => {
  const page = readFileSync("app/admin/facturacion/page.tsx", "utf8");
  const manual = readFileSync("components/admin/dte/ManualIssuanceForm.tsx", "utf8");
  const activation = readFileSync("components/admin/dte/LegalActivationControl.tsx", "utf8");
  for (const label of [
    "Documentos", "Emitir manualmente", "Emisión automática",
    "Configuración tributaria", "Modo técnico avanzado", "Autorización SII",
  ]) assert.match(page, new RegExp(label));
  assert.match(page, /Reintentar/);
  assert.match(manual, /Reserva existente/);
  assert.match(manual, /Pago verificado/);
  assert.match(manual, /Sin reserva ni pago/);
  assert.match(manual, /Revisión final explícita/);
  assert.match(activation, /Activar emisión legal/);
  assert.match(activation, /Pausar emisión/);
});

test("draft document labels match exact dte_type without inference", () => {
  const page = readFileSync("app/admin/facturacion/page.tsx", "utf8");
  assert.match(page, /if\s*\(type === 33\)\s*return "Factura electrónica";/);
  assert.match(page, /if\s*\(type === 39\)\s*return "Boleta electrónica";/);
});
