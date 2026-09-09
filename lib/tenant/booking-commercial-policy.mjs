export const BOOKING_TAX_DOCUMENT_MODES = new Set([
  "unconfigured",
  "citaya_dte",
  "external_bhe",
]);

function explicitDteType(value) {
  return value === 33 || value === 39 ? value : null;
}

/**
 * Resolve the commercial/tax side effects allowed for appointment creation.
 *
 * This is intentionally independent from `operational_mode`: a live tenant may
 * run agenda + communications while payments and Citaya DTE stay disabled.
 * `external_bhe` means the professional documents the service outside the DTE
 * 33/39 pipeline; it must never be represented internally as DTE 39/exempt.
 */
export function resolveBookingCommercialPolicy(input) {
  const isDemoAppointment = input?.isDemoAppointment === true;
  const isAdminRequest = input?.isAdminRequest === true;
  const paymentsEnabled = input?.paymentsEnabled === true;
  const dteEnabled = input?.dteEnabled === true;
  const taxDocumentMode = String(input?.taxDocumentMode ?? "unconfigured");
  const requestedExplicitDte = explicitDteType(input?.taxDocumentType);
  const invoiceRequested = input?.invoiceRequested === true;
  const servicePaymentPolicy = String(input?.servicePaymentPolicy ?? "no_advance");

  if (isDemoAppointment) {
    return {
      requestedDocumentType: null,
      requirePaymentConfiguration: false,
      requireDteServiceConfiguration: false,
      requireDepositTaxPolicy: false,
      paymentRequired: false,
      persistDteSnapshot: false,
      initializeDteBilling: false,
      loadDteIssuanceConfig: false,
      taxDocumentMode: "unconfigured",
    };
  }

  if (!BOOKING_TAX_DOCUMENT_MODES.has(taxDocumentMode)) {
    throw new Error("BOOKING_TAX_DOCUMENT_MODE_INVALID");
  }
  if (taxDocumentMode === "unconfigured") {
    throw new Error("BOOKING_TAX_DOCUMENT_MODE_UNCONFIGURED");
  }

  if (taxDocumentMode === "external_bhe") {
    if (dteEnabled) throw new Error("BOOKING_EXTERNAL_BHE_DTE_MISMATCH");
    if (requestedExplicitDte || invoiceRequested) {
      throw new Error("BOOKING_DTE_SELECTION_NOT_AVAILABLE");
    }
    return {
      requestedDocumentType: null,
      requirePaymentConfiguration: paymentsEnabled,
      requireDteServiceConfiguration: false,
      requireDepositTaxPolicy: false,
      paymentRequired: paymentsEnabled && servicePaymentPolicy !== "no_advance",
      persistDteSnapshot: false,
      initializeDteBilling: false,
      loadDteIssuanceConfig: false,
      taxDocumentMode,
    };
  }

  if (!dteEnabled) throw new Error("BOOKING_CITAYA_DTE_FEATURE_DISABLED");

  const requestedDocumentType = requestedExplicitDte
    ?? (invoiceRequested ? 33 : isAdminRequest ? 39 : null);

  return {
    requestedDocumentType,
    requirePaymentConfiguration: paymentsEnabled,
    requireDteServiceConfiguration: true,
    requireDepositTaxPolicy:
      paymentsEnabled && servicePaymentPolicy === "deposit",
    paymentRequired: paymentsEnabled && servicePaymentPolicy !== "no_advance",
    persistDteSnapshot: true,
    initializeDteBilling: true,
    loadDteIssuanceConfig: true,
    taxDocumentMode,
  };
}
