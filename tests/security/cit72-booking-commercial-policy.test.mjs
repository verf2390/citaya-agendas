import test from "node:test";
import assert from "node:assert/strict";

import { resolveBookingCommercialPolicy } from "../../lib/tenant/booking-commercial-policy.mjs";

test("external BHE live booking never falls into DTE 33/39", () => {
  const policy = resolveBookingCommercialPolicy({
    isDemoAppointment: false,
    isAdminRequest: true,
    paymentsEnabled: false,
    dteEnabled: false,
    taxDocumentMode: "external_bhe",
    servicePaymentPolicy: "no_advance",
  });

  assert.equal(policy.requestedDocumentType, null);
  assert.equal(policy.persistDteSnapshot, false);
  assert.equal(policy.initializeDteBilling, false);
  assert.equal(policy.requireDteServiceConfiguration, false);
  assert.equal(policy.loadDteIssuanceConfig, false);
  assert.equal(policy.paymentRequired, false);
});

test("external BHE rejects an explicit invoice or DTE selection", () => {
  assert.throws(
    () => resolveBookingCommercialPolicy({
      isDemoAppointment: false,
      isAdminRequest: false,
      paymentsEnabled: false,
      dteEnabled: false,
      taxDocumentMode: "external_bhe",
      taxDocumentType: 39,
      servicePaymentPolicy: "no_advance",
    }),
    /BOOKING_DTE_SELECTION_NOT_AVAILABLE/,
  );

  assert.throws(
    () => resolveBookingCommercialPolicy({
      isDemoAppointment: false,
      isAdminRequest: false,
      paymentsEnabled: false,
      dteEnabled: false,
      taxDocumentMode: "external_bhe",
      invoiceRequested: true,
      servicePaymentPolicy: "no_advance",
    }),
    /BOOKING_DTE_SELECTION_NOT_AVAILABLE/,
  );
});

test("payments OFF means a live appointment does not require payment configuration", () => {
  const policy = resolveBookingCommercialPolicy({
    isDemoAppointment: false,
    isAdminRequest: false,
    paymentsEnabled: false,
    dteEnabled: false,
    taxDocumentMode: "external_bhe",
    servicePaymentPolicy: "deposit",
  });

  assert.equal(policy.requirePaymentConfiguration, false);
  assert.equal(policy.requireDepositTaxPolicy, false);
  assert.equal(policy.paymentRequired, false);
});

test("Citaya DTE preserves admin default boleta 39 and DTE side effects", () => {
  const policy = resolveBookingCommercialPolicy({
    isDemoAppointment: false,
    isAdminRequest: true,
    paymentsEnabled: true,
    dteEnabled: true,
    taxDocumentMode: "citaya_dte",
    servicePaymentPolicy: "full_payment",
  });

  assert.equal(policy.requestedDocumentType, 39);
  assert.equal(policy.requirePaymentConfiguration, true);
  assert.equal(policy.requireDteServiceConfiguration, true);
  assert.equal(policy.paymentRequired, true);
  assert.equal(policy.persistDteSnapshot, true);
  assert.equal(policy.initializeDteBilling, true);
  assert.equal(policy.loadDteIssuanceConfig, true);
});

test("unconfigured live tax mode fails closed", () => {
  assert.throws(
    () => resolveBookingCommercialPolicy({
      isDemoAppointment: false,
      isAdminRequest: false,
      paymentsEnabled: false,
      dteEnabled: false,
      taxDocumentMode: "unconfigured",
      servicePaymentPolicy: "no_advance",
    }),
    /BOOKING_TAX_DOCUMENT_MODE_UNCONFIGURED/,
  );
});

test("demo booking remains side-effect free", () => {
  const policy = resolveBookingCommercialPolicy({
    isDemoAppointment: true,
    isAdminRequest: true,
    paymentsEnabled: true,
    dteEnabled: true,
    taxDocumentMode: "citaya_dte",
    taxDocumentType: 39,
    servicePaymentPolicy: "deposit",
  });

  assert.equal(policy.requestedDocumentType, null);
  assert.equal(policy.requirePaymentConfiguration, false);
  assert.equal(policy.requireDteServiceConfiguration, false);
  assert.equal(policy.paymentRequired, false);
  assert.equal(policy.persistDteSnapshot, false);
  assert.equal(policy.initializeDteBilling, false);
});
