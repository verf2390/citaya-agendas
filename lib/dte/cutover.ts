import { normalizeRut, validateRut } from "./rut";

export const DTE_DELIVERABLE_STATES = new Set([
  "ACCEPTED",
  "ACCEPTED_WITH_OBJECTIONS",
  "DELIVERY_PENDING",
  "DELIVERED",
]);

export type CustomerTaxProfileInput = {
  rut: string;
  legalName: string;
  businessActivity: string;
  address: string;
  commune: string;
  city: string;
  taxEmail: string;
};

export function resolveBookingTaxDocumentType(input: {
  isAdminRequest: boolean;
  isDemoAppointment: boolean;
  taxDocumentType?: 33 | 39 | null;
  invoiceRequested?: boolean;
}): 33 | 39 | null {
  if (input.isDemoAppointment) return null;
  if (input.taxDocumentType === 33 || input.taxDocumentType === 39) {
    return input.taxDocumentType;
  }
  if (input.invoiceRequested === true) return 33;
  return input.isAdminRequest ? 39 : null;
}

export type ActivationGates = {
  issuerDataExact: boolean;
  issuerLegalNameMatch: boolean;
  issuerResolutionConfigured: boolean;
  typeAuthorized: boolean;
  certificateCurrent: boolean;
  certificateKeyMatch: boolean;
  certificateRutMatch: boolean;
  officialTrustAnchor: boolean;
  authenticTypeCaf: boolean;
  foliosAvailable: boolean;
  tenantAwareLedger: boolean;
  privateStorage: boolean;
  productionEndpoints: boolean;
  officialXsd: boolean;
  xmlDsig: boolean;
  workerConfigured: boolean;
  migrationsApplied: boolean;
  offlinePreflightComplete: boolean;
  documentEngineReady: boolean;
  globalFeatureEnabled: boolean;
};

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

export function normalizeRequiredCustomerRut(value: unknown): string {
  const raw = clean(value, 32);
  if (!raw || !validateRut(raw)) throw new Error("CUSTOMER_RUT_INVALID");
  return normalizeRut(raw);
}

export function normalizeTaxProfile(
  value: Partial<CustomerTaxProfileInput> | null | undefined,
): CustomerTaxProfileInput {
  const profile = {
    rut: normalizeRequiredCustomerRut(value?.rut),
    legalName: clean(value?.legalName, 180),
    businessActivity: clean(value?.businessActivity, 180),
    address: clean(value?.address, 180),
    commune: clean(value?.commune, 100),
    city: clean(value?.city, 100),
    taxEmail: clean(value?.taxEmail, 254).toLowerCase(),
  };
  if (
    profile.legalName.length < 2 ||
    profile.businessActivity.length < 2 ||
    profile.address.length < 2 ||
    profile.commune.length < 2 ||
    profile.city.length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.taxEmail)
  ) {
    throw new Error("CUSTOMER_TAX_PROFILE_INCOMPLETE");
  }
  return profile;
}

export function validateBookingTaxInput(input: {
  customerRut: unknown;
  invoiceRequested: boolean;
  taxDocumentType?: 33 | 39 | null;
  taxProfile?: Partial<CustomerTaxProfileInput> | null;
}) {
  const requestedDocumentType =
    input.taxDocumentType === 33 || input.taxDocumentType === 39
      ? input.taxDocumentType
      : input.invoiceRequested
        ? 33
        : null;
  const customerRut = requestedDocumentType === 33
    ? normalizeRequiredCustomerRut(input.customerRut)
    : "";
  if (requestedDocumentType !== 33) {
    return {
      customerRut,
      requestedDocumentType,
      taxProfile: null,
    };
  }
  const taxProfile = normalizeTaxProfile(input.taxProfile);
  return {
    customerRut,
    requestedDocumentType: 33 as const,
    taxProfile,
  };
}

export function manualIssuanceIdempotencyMaterial(input: {
  tenantId: string;
  key: string;
  appointmentId?: string | null;
  paymentIntentId?: string | null;
  customerId: string;
  dteType: number;
}) {
  return [
    input.tenantId,
    input.key,
    input.appointmentId ?? "standalone",
    input.paymentIntentId ?? "no-payment",
    input.customerId,
    String(input.dteType),
  ].join("|");
}

export function validateStandaloneLines(
  lines: Array<{
    description?: unknown;
    quantity?: unknown;
    unitPrice?: unknown;
  }>,
) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    throw new Error("DTE_LINES_INVALID");
  }
  return lines.map((line) => {
    const description = clean(line.description, 180);
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    if (
      description.length < 2 ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10_000 ||
      !Number.isSafeInteger(unitPrice) ||
      unitPrice < 0
    ) {
      throw new Error("DTE_LINES_INVALID");
    }
    return { description, quantity, unitPrice };
  });
}

export function activationGateResult(gates: ActivationGates) {
  const missing = (
    Object.entries(gates) as Array<[keyof ActivationGates, boolean]>
  )
    .filter(([, ready]) => ready !== true)
    .map(([key]) => key);
  return { ready: missing.length === 0, missing };
}

export function canEmailDte(status: string): boolean {
  return DTE_DELIVERABLE_STATES.has(String(status).toUpperCase());
}

export function canonicalIntentStatusForSiiStatus(
  siiStatus: string | null | undefined,
): "SUBMITTED" | "ACCEPTED" | "ACCEPTED_WITH_OBJECTIONS" | "REJECTED" {
  const normalized = String(siiStatus ?? "")
    .trim()
    .toLowerCase();
  if (["accepted", "epr", "aceptado", "dok"].includes(normalized))
    return "ACCEPTED";
  if (
    ["accepted_with_observations", "accepted_with_objections", "eok"].includes(
      normalized,
    )
  ) {
    return "ACCEPTED_WITH_OBJECTIONS";
  }
  if (["rejected", "rch", "rechazado"].includes(normalized)) return "REJECTED";
  return "SUBMITTED";
}

export function planSiiStatusReconciliation(
  currentIntentStatus: string | null | undefined,
  siiStatus: string | null | undefined,
) {
  const normalizedSiiStatus = String(siiStatus ?? "")
    .trim()
    .toLowerCase();
  const currentStatus = String(currentIntentStatus ?? "").toUpperCase();
  const reconcilable = [
    "accepted",
    "epr",
    "aceptado",
    "dok",
    "accepted_with_observations",
    "accepted_with_objections",
    "eok",
    "rejected",
    "rch",
    "rechazado",
    "sent",
    "rec",
    "processing",
    "pdr",
  ].includes(normalizedSiiStatus);
  const targetStatus = canonicalIntentStatusForSiiStatus(siiStatus);
  return {
    targetStatus: reconcilable ? targetStatus : currentStatus || "SUBMITTED",
    shouldReconcile: reconcilable && currentStatus !== targetStatus,
  };
}

export function friendlyDteReason(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  if (reason === "operator_amount_error_before_issuance") {
    return "El monto no coincidía con la operación y la emisión fue cancelada antes de utilizar un folio.";
  }
  return reason;
}

export function friendlyDteStatus(
  status: string | null | undefined,
  reason?: string | null,
  siiStatus?: string | null,
): string {
  const normalized = String(status ?? "").toUpperCase();
  const normalizedSiiStatus = String(siiStatus ?? "")
    .trim()
    .toLowerCase();
  const canonicalSiiStatus = canonicalIntentStatusForSiiStatus(siiStatus);

  // Once the canonical intent is terminal, an older/intermediate SII label such
  // as REC must never visually regress the document back to "Recibido".
  if (normalized === "ACCEPTED") return "Aceptada por el SII";
  if (normalized === "ACCEPTED_WITH_OBJECTIONS") {
    return "Aceptado por el SII con reparos";
  }
  if (normalized === "REJECTED") return "Rechazada por el SII";
  if (normalized === "CANCELED") return "Emisión cancelada";

  // A final persisted SII status may still improve a stale non-terminal intent
  // while reconciliation is pending.
  if (canonicalSiiStatus === "ACCEPTED") return "Aceptada por el SII";
  if (canonicalSiiStatus === "ACCEPTED_WITH_OBJECTIONS") {
    return "Aceptado por el SII con reparos";
  }
  if (canonicalSiiStatus === "REJECTED") return "Rechazada por el SII";
  if (["sent", "rec", "processing", "pdr"].includes(normalizedSiiStatus)) {
    return "Recibido por el SII";
  }
  if (normalized === "DRAFT") return "Borrador";
  if (normalized === "REVIEW_REQUIRED") return "Requiere revisión";
  if (normalized === "VALIDATED") return "Validado";
  if (
    normalized === "BLOCKED" &&
    ["BLOCKED_NOT_AUTHORIZED", "DOCUMENT_TYPE_NOT_AUTHORIZED"].includes(
      String(reason),
    )
  ) {
    return "Boleta no autorizada";
  }
  if (
    ["PENDING", "QUEUED", "PREPARING", "READY", "SUBMITTING"].includes(
      normalized,
    )
  ) {
    return "Preparando emisión";
  }
  if (normalized === "SUBMITTED") return "Recibido por el SII";
  if (["AMBIGUOUS", "BLOCKED"].includes(normalized)) return "Error de envío";
  if (normalized === "PAUSED") return "Emisión pausada";
  return "Estado no disponible";
}
