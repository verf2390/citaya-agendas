import { normalizeRut } from "../rut";
import type { FacturaCertificationCaseId } from "./factura-electronica-set";

export type PreCafIssuerData = {
  rutEmisor?: string | null;
  razonSocial?: string | null;
  giroEmisor?: string | null;
  acteco?: string | null;
  direccionOrigen?: string | null;
  comunaOrigen?: string | null;
  ciudadOrigen?: string | null;
  fechaResolucion?: string | null;
  numeroResolucion?: number | null;
  rutEnvia?: string | null;
  periodoTributario?: string | null;
};

export type PreCafCounterpartyData = {
  rut?: string | null;
  razonSocial?: string | null;
  giro?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
};

export type PreCafTextCorrectionData = {
  giroAnterior?: string | null;
  giroCorregido?: string | null;
};

export type PreCafExternalDataContract = {
  issuer?: PreCafIssuerData | null;
  receivers?: Partial<Record<"receiver1" | "receiver2" | "receiver3" | "receiver4", PreCafCounterpartyData>> | null;
  textCorrection?: PreCafTextCorrectionData | null;
  purchaseProviders?: Partial<Record<"4959700-1" | "4959700-2" | "4959700-3" | "4959700-4" | "4959700-5" | "4959700-6" | "4959700-7", Pick<PreCafCounterpartyData, "rut" | "razonSocial">>> | null;
};

export type PreCafExternalDataValidation = {
  ok: boolean;
  missingFields: string[];
  invalidFields: string[];
};

function present(value: unknown): boolean {
  return typeof value === "number" ? Number.isFinite(value) : String(value ?? "").trim().length > 0;
}

function requireField(fields: string[], name: string, value: unknown): void {
  if (!present(value)) fields.push(name);
}

function validateRutField(invalid: string[], name: string, value: unknown): string | null {
  if (!present(value)) return null;
  try {
    return normalizeRut(String(value));
  } catch {
    invalid.push(name);
    return null;
  }
}

export function validatePreCafExternalData(input: PreCafExternalDataContract): PreCafExternalDataValidation {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const issuer = input.issuer ?? {};
  for (const [name, value] of Object.entries({
    "issuer.rutEmisor": issuer.rutEmisor,
    "issuer.razonSocial": issuer.razonSocial,
    "issuer.giroEmisor": issuer.giroEmisor,
    "issuer.acteco": issuer.acteco,
    "issuer.direccionOrigen": issuer.direccionOrigen,
    "issuer.comunaOrigen": issuer.comunaOrigen,
    "issuer.ciudadOrigen": issuer.ciudadOrigen,
    "issuer.fechaResolucion": issuer.fechaResolucion,
    "issuer.numeroResolucion": issuer.numeroResolucion,
    "issuer.rutEnvia": issuer.rutEnvia,
    "issuer.periodoTributario": issuer.periodoTributario,
  })) requireField(missingFields, name, value);
  const issuerRut = validateRutField(invalidFields, "issuer.rutEmisor", issuer.rutEmisor);
  validateRutField(invalidFields, "issuer.rutEnvia", issuer.rutEnvia);
  if (present(issuer.periodoTributario) && !/^\d{4}-\d{2}$/.test(String(issuer.periodoTributario))) invalidFields.push("issuer.periodoTributario");
  if (present(issuer.fechaResolucion) && !/^\d{4}-\d{2}-\d{2}$/.test(String(issuer.fechaResolucion))) invalidFields.push("issuer.fechaResolucion");
  if (present(issuer.numeroResolucion) && (!Number.isSafeInteger(issuer.numeroResolucion) || Number(issuer.numeroResolucion) < 0)) invalidFields.push("issuer.numeroResolucion");

  const receiverRuts = new Set<string>();
  for (const key of ["receiver1", "receiver2", "receiver3", "receiver4"] as const) {
    const receiver = input.receivers?.[key] ?? {};
    for (const [field, value] of Object.entries({ rut: receiver.rut, razonSocial: receiver.razonSocial, giro: receiver.giro, direccion: receiver.direccion, comuna: receiver.comuna, ciudad: receiver.ciudad })) {
      requireField(missingFields, `receivers.${key}.${field}`, value);
    }
    const rut = validateRutField(invalidFields, `receivers.${key}.rut`, receiver.rut);
    if (rut) {
      if (receiverRuts.has(rut)) invalidFields.push("receivers.distinctRut");
      if (issuerRut && rut === issuerRut) invalidFields.push("counterparties.issuerExcluded");
      receiverRuts.add(rut);
    }
  }

  const text = input.textCorrection ?? {};
  requireField(missingFields, "textCorrection.giroAnterior", text.giroAnterior);
  requireField(missingFields, "textCorrection.giroCorregido", text.giroCorregido);
  if (present(text.giroAnterior) && present(text.giroCorregido) && String(text.giroAnterior).trim() === String(text.giroCorregido).trim()) invalidFields.push("textCorrection.giroAnteriorDifferentFromGiroCorregido");
  if (present(text.giroCorregido) && present(input.receivers?.receiver1?.giro) && String(text.giroCorregido).trim() !== String(input.receivers?.receiver1?.giro).trim()) invalidFields.push("textCorrection.giroCorregidoMatchesReceiver1Giro");

  const providerRuts = new Set<string>();
  for (const caseId of ["4959700-1", "4959700-2", "4959700-3", "4959700-4", "4959700-5", "4959700-6", "4959700-7"] as const) {
    const provider = input.purchaseProviders?.[caseId] ?? {};
    requireField(missingFields, `purchaseProviders.${caseId}.rut`, provider.rut);
    requireField(missingFields, `purchaseProviders.${caseId}.razonSocial`, provider.razonSocial);
    const rut = validateRutField(invalidFields, `purchaseProviders.${caseId}.rut`, provider.rut);
    if (rut) {
      if (providerRuts.has(rut)) invalidFields.push("purchaseProviders.distinctRut");
      if (issuerRut && rut === issuerRut) invalidFields.push("counterparties.issuerExcluded");
      providerRuts.add(rut);
    }
  }

  return {
    ok: missingFields.length === 0 && invalidFields.length === 0,
    missingFields: [...new Set(missingFields)].sort(),
    invalidFields: [...new Set(invalidFields)].sort(),
  };
}

export const PRE_CAF_REQUIRED_CASE_ORDER: readonly FacturaCertificationCaseId[] = ["4959698-1", "4959698-2", "4959698-3", "4959698-4", "4959698-5", "4959698-6", "4959698-7", "4959698-8"];
