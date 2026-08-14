import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryIssuanceCoordinator,
  assertTenantStorageAccess,
  processOutboxItem,
  resolveAutomaticIssuance,
  shouldDeliverEmail,
  tenantStorageKey,
} from "../lib/dte/automation/issuance-policy.mjs";

const tenantId = "tenant-a";
const appointment = {
  id: "appointment-a",
  tenantId,
  canceled: false,
  serverAmount: 25000,
  invoiceRequested: true,
  taxTreatmentSnapshot: "affected",
  receiver: {
    rut: "76.543.210-3",
    legalName: "Cliente Prueba SpA",
    activity: "Servicios",
    address: "Dirección 123",
    commune: "Santiago",
  },
};
const payment = {
  tenantId,
  appointmentId: appointment.id,
  paymentKey: "webpay:verified-a",
  verified: true,
  verifiedAmount: 25000,
  currency: "CLP",
};
const config = {
  issuanceMode: "automatic_on_verified_payment",
  consumerDocumentType: "unsupported",
  invoiceOnRequest: true,
  productionEnabled: true,
  siiAuthorizationStatus: "approved",
  certificateReady: true,
  certificateCurrent: true,
  cafReady: true,
  folioReady: true,
  endpointsReady: true,
  storageReady: true,
  workerReady: true,
  readinessTestsGreen: true,
};
const context = { globalProductionEnabled: true, config };

function coordinator() {
  return new InMemoryIssuanceCoordinator();
}

test("payment first and appointment later creates exactly one document intent", () => {
  const value = coordinator();
  assert.equal(value.recordPayment(payment, context), null);
  assert.equal(value.recordAppointment(appointment, context)?.status, "PENDING");
  assert.equal(value.intents().length, 1);
});

test("appointment first and payment later creates exactly one document intent", () => {
  const value = coordinator();
  assert.equal(value.recordAppointment(appointment, context), null);
  assert.equal(value.recordPayment(payment, context)?.status, "PENDING");
  assert.equal(value.intents().length, 1);
});

test("duplicate webhook remains exactly once", () => {
  const value = coordinator();
  value.recordAppointment(appointment, context);
  value.recordPayment(payment, context);
  value.recordPayment(payment, context);
  assert.equal(value.intents().length, 1);
});

test("concurrent duplicate events remain exactly once", async () => {
  const value = coordinator();
  await Promise.all([
    Promise.resolve().then(() => value.recordAppointment(appointment, context)),
    Promise.resolve().then(() => value.recordPayment(payment, context)),
    Promise.resolve().then(() => value.recordPayment(payment, context)),
  ]);
  assert.equal(value.intents().length, 1);
});

test("manipulated amount is blocked", () => {
  const result = resolveAutomaticIssuance({ ...context, appointment, payment: { ...payment, verifiedAmount: 1 } });
  assert.equal(result.reason, "PAYMENT_AMOUNT_MISMATCH");
});

test("invoice requested without receiver tax data is blocked", () => {
  const result = resolveAutomaticIssuance({ ...context, appointment: { ...appointment, receiver: {} }, payment });
  assert.equal(result.reason, "INVOICE_RECEIVER_DATA_INCOMPLETE");
});

test("invoice on request is implemented for type 33 when every gate is green", () => {
  const result = resolveAutomaticIssuance({ ...context, appointment, payment });
  assert.equal(result.status, "PENDING");
  assert.equal(result.documentType, 33);
});

test("consumer receipt 39 is supported without silent factura fallback", () => {
  const result = resolveAutomaticIssuance({
    globalProductionEnabled: true,
    config: { ...config, consumerDocumentType: "39" },
    appointment: { ...appointment, invoiceRequested: false },
    payment,
  });
  assert.equal(result.status, "PENDING");
  assert.equal(result.documentType, 39);
});

test("consumer receipt 41 and unknown types stay blocked without factura fallback", () => {
  for (const consumerDocumentType of ["41", "unsupported"]) {
    const result = resolveAutomaticIssuance({
      globalProductionEnabled: true,
      config: { ...config, consumerDocumentType },
      appointment: { ...appointment, invoiceRequested: false },
      payment,
    });
    assert.equal(result.status, "BLOCKED");
    assert.ok(["DOCUMENT_TYPE_UNSUPPORTED", "CONSUMER_DOCUMENT_UNSUPPORTED"].includes(result.reason));
    assert.notEqual(result.documentType, 33);
  }
});

test("unauthorized tenant is blocked", () => {
  const result = resolveAutomaticIssuance({ ...context, config: { ...config, siiAuthorizationStatus: "pending" }, appointment, payment });
  assert.equal(result.reason, "TENANT_NOT_AUTHORIZED");
});

test("certificate, CAF and folio gates fail closed", () => {
  const cases = [
    ["certificateReady", "CERTIFICATE_NOT_READY"],
    ["cafReady", "CAF_NOT_READY"],
    ["folioReady", "FOLIO_NOT_READY"],
  ];
  for (const [field, reason] of cases) {
    const result = resolveAutomaticIssuance({ ...context, config: { ...config, [field]: false }, appointment, payment });
    assert.equal(result.reason, reason);
  }
});

test("SII timeout or ambiguous result causes zero automatic retry", async () => {
  let networkCalls = 0;
  let ambiguousCalls = 0;
  const result = await processOutboxItem({
    globalProductionEnabled: true,
    deterministicRetries: 0,
    prepare: async () => {},
    submitExactlyOnce: async () => { networkCalls += 1; throw new Error("timeout"); },
    markBlocked: async () => {},
    markDeterministicFailure: async () => {},
    markAmbiguous: async () => { ambiguousCalls += 1; },
  });
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.automaticRetries, 0);
  assert.equal(networkCalls, 1);
  assert.equal(ambiguousCalls, 1);
});

test("cancellation before issuance produces zero emission", () => {
  const value = coordinator();
  value.recordAppointment(appointment, context);
  value.recordPayment(payment, context);
  assert.equal(value.cancel(tenantId, appointment.id), 1);
  assert.equal(value.intents()[0].status, "CANCELED");
  assert.equal(value.intents()[0].networkAttempts, 0);
});

test("storage path and download access are isolated by tenant", () => {
  const key = tenantStorageKey("tenant-a", "document-a", "33.xml");
  assert.equal(key, "tenant-a/document-a/33.xml");
  assert.equal(assertTenantStorageAccess("tenant-a", key), true);
  assert.throws(() => assertTenantStorageAccess("tenant-b", key), /TENANT_MISMATCH/);
});

test("email delivery only occurs in configured deliverable state", () => {
  assert.equal(shouldDeliverEmail("SUBMITTED", true), false);
  assert.equal(shouldDeliverEmail("ACCEPTED", false), false);
  assert.equal(shouldDeliverEmail("ACCEPTED", true), true);
  assert.equal(shouldDeliverEmail("DELIVERY_PENDING", true), true);
});

test("DTE_PRODUCTION_ENABLED=false performs zero SII network calls", async () => {
  let networkCalls = 0;
  let blockedReason = "";
  const result = await processOutboxItem({
    globalProductionEnabled: false,
    prepare: async () => {},
    submitExactlyOnce: async () => { networkCalls += 1; return { status: "SUBMITTED" }; },
    markBlocked: async (reason) => { blockedReason = reason; },
    markDeterministicFailure: async () => {},
    markAmbiguous: async () => {},
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(blockedReason, "GLOBAL_PRODUCTION_DISABLED");
  assert.equal(networkCalls, 0);
});

test("different tenants keep independent tax state and reject cross-tenant signals", () => {
  const value = coordinator();
  value.recordAppointment(appointment, context);
  const mismatch = value.recordPayment({ ...payment, tenantId: "tenant-b" }, context);
  assert.equal(mismatch, null);
  value.recordPayment(payment, context);
  value.recordAppointment({ ...appointment, id: "appointment-b", tenantId: "tenant-b" }, {
    globalProductionEnabled: true,
    config: { ...config, siiAuthorizationStatus: "not_configured" },
  });
  value.recordPayment({ ...payment, appointmentId: "appointment-b", tenantId: "tenant-b", paymentKey: "payment-b" }, {
    globalProductionEnabled: true,
    config: { ...config, siiAuthorizationStatus: "not_configured" },
  });
  const intents = value.intents();
  assert.equal(intents.find((item) => item.tenantId === "tenant-a")?.status, "PENDING");
  assert.equal(intents.find((item) => item.tenantId === "tenant-b")?.reason, "TENANT_NOT_AUTHORIZED");
});
