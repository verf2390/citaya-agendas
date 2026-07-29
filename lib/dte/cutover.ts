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
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
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
  taxProfile?: Partial<CustomerTaxProfileInput> | null;
}) {
  const customerRut = normalizeRequiredCustomerRut(input.customerRut);
  if (!input.invoiceRequested) {
    return {
      customerRut,
      requestedDocumentType: 39 as const,
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
  lines: Array<{ description?: unknown; quantity?: unknown; unitPrice?: unknown }>,
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
  const missing = (Object.entries(gates) as Array<
    [keyof ActivationGates, boolean]
  >)
    .filter(([, ready]) => ready !== true)
    .map(([key]) => key);
  return { ready: missing.length === 0, missing };
}

export function canEmailDte(status: string): boolean {
  return DTE_DELIVERABLE_STATES.has(String(status).toUpperCase());
}

export function friendlyDteStatus(
  status: string | null | undefined,
  reason?: string | null,
): string {
  const normalized = String(status ?? "").toUpperCase();
  if (normalized === "BLOCKED" && ["BLOCKED_NOT_AUTHORIZED", "DOCUMENT_TYPE_NOT_AUTHORIZED"].includes(String(reason))) {
    return "Boleta no autorizada";
  }
  if (normalized === "PENDING") return "Pendiente de procesamiento";
  if (["PREPARING", "READY", "SUBMITTING"].includes(normalized)) return "Procesando emisión";
  if (normalized === "SUBMITTED") return "Enviado al SII";
  if (normalized === "ACCEPTED") return "Documento aceptado";
  if (normalized === "ACCEPTED_WITH_OBJECTIONS") return "Documento con reparos";
  if (normalized === "REJECTED") return "Emisión fallida: rechazo SII";
  if (normalized === "AMBIGUOUS") return "Emisión fallida: resultado ambiguo";
  if (normalized === "BLOCKED") return `Emisión fallida: ${reason ?? "control pendiente"}`;
  if (normalized === "CANCELED") return "Emisión cancelada";
  if (normalized === "PAUSED") return "Emisión pausada";
  return "Estado no disponible";
}
