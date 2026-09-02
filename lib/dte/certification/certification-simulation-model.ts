import { getSiiDteTypeCode } from "../dte-types";
import type {
  TaxDocumentDraft,
  TaxDocumentRecipient,
  TenantTaxProfile,
} from "../types";

export const CERTIFICATION_SIMULATION_PLAN = [
  { caseId: "simulation-33-09", typeCode: 33, folio: 9 },
  { caseId: "simulation-33-10", typeCode: 33, folio: 10 },
  { caseId: "simulation-33-11", typeCode: 33, folio: 11 },
  { caseId: "simulation-33-12", typeCode: 33, folio: 12 },
  { caseId: "simulation-33-13", typeCode: 33, folio: 13 },
  { caseId: "simulation-33-14", typeCode: 33, folio: 14 },
  { caseId: "simulation-33-15", typeCode: 33, folio: 15 },
  { caseId: "simulation-33-16", typeCode: 33, folio: 16 },
  { caseId: "simulation-56-03", typeCode: 56, folio: 3 },
  { caseId: "simulation-61-07", typeCode: 61, folio: 7 },
] as const;

export const CERTIFICATION_SIMULATION_FOLIOS_PLAN = "33:9-16,56:3,61:7";
export const CERTIFICATION_SIMULATION_CONTINGENCY = "56:4,61:8-12";

const services = [
  ["DESARROLLO SITIO WEB CORPORATIVO", 120000],
  ["IMPLEMENTACION AGENDA DIGITAL", 185000],
  ["OPTIMIZACION EXPERIENCIA MOVIL", 96000],
  ["DESARROLLO MODULO DE RESERVAS", 245000],
  ["INTEGRACION ANALITICA WEB", 150000],
  ["DESARROLLO PORTAL AUTOATENCION", 310000],
  ["MANTENCION PLATAFORMA DIGITAL", 78000],
  ["INTEGRACION NOTIFICACIONES WEB", 205000],
] as const;

export type CertificationSimulationIdentity = {
  issuer: TenantTaxProfile;
  recipients: readonly TaxDocumentRecipient[];
  rutEnvia: string;
  issueDate: string;
};

function reject(field: string): never {
  throw new Error("CERTIFICATION_SIMULATION_REJECTED field=" + field);
}

function taxableTotals(netAmount: number): { net: number; tax: number; total: number } {
  if (!Number.isSafeInteger(netAmount) || netAmount <= 0) reject("netAmount");
  const tax = Math.round(netAmount * 0.19);
  return { net: netAmount, tax, total: netAmount + tax };
}

function baseDraft(
  identity: CertificationSimulationIdentity,
  recipient: TaxDocumentRecipient,
  folio: number,
  documentType: TaxDocumentDraft["documentType"],
  service: string,
  netAmount: number,
): TaxDocumentDraft {
  const totals = taxableTotals(netAmount);
  return {
    tenantId: "citaya-certification-simulation-001",
    issueMode: "citaya_own_dte",
    documentType,
    status: "pending_signature",
    folio,
    issueDate: identity.issueDate,
    issuer: identity.issuer,
    recipient,
    lines: [
      {
        name: service,
        description: "SERVICIO DIGITAL SEGUN ALCANCE ACORDADO",
        quantity: 1,
        unitPrice: totals.net,
        amount: totals.net,
        exempt: false,
      },
    ],
    netAmount: totals.net,
    exemptAmount: 0,
    taxAmount: totals.tax,
    totalAmount: totals.total,
  };
}

export function buildCertificationSimulationDrafts(
  identity: CertificationSimulationIdentity,
): TaxDocumentDraft[] {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(identity.issueDate) ||
    identity.recipients.length < 2 ||
    !identity.rutEnvia.trim()
  ) reject("identity");
  const invoices = services.map(([service, netAmount], index) =>
    baseDraft(
      identity,
      identity.recipients[index % identity.recipients.length] ?? reject("recipient"),
      9 + index,
      "factura_afecta",
      service,
      netAmount,
    ),
  );
  const debit = baseDraft(
    identity,
    invoices[0].recipient,
    3,
    "nota_debito",
    "AMPLIACION DE ALCANCE DESARROLLO WEB",
    35000,
  );
  debit.references = [{
    documentType: "33",
    folio: "9",
    date: identity.issueDate,
    code: "3",
    reason: "AUMENTA MONTO POR AMPLIACION DE ALCANCE",
  }];
  const credit = baseDraft(
    identity,
    invoices[1].recipient,
    7,
    "nota_credito",
    "AJUSTE SERVICIO DE IMPLEMENTACION DIGITAL",
    25000,
  );
  credit.references = [{
    documentType: "33",
    folio: "10",
    date: identity.issueDate,
    code: "3",
    reason: "DISMINUYE MONTO POR AJUSTE DE ALCANCE",
  }];
  const drafts = [...invoices, debit, credit];
  assertCertificationSimulationDrafts(drafts);
  return drafts;
}

export function assertCertificationSimulationDrafts(
  drafts: readonly TaxDocumentDraft[],
): void {
  if (drafts.length !== CERTIFICATION_SIMULATION_PLAN.length)
    reject("documentsCount");
  drafts.forEach((draft, index) => {
    const plan = CERTIFICATION_SIMULATION_PLAN[index] ?? reject("plan");
    if (
      getSiiDteTypeCode(draft.documentType) !== plan.typeCode ||
      draft.folio !== plan.folio ||
      draft.totalAmount !==
        (draft.netAmount ?? 0) + (draft.exemptAmount ?? 0) + (draft.taxAmount ?? 0) ||
      draft.taxAmount !== Math.round((draft.netAmount ?? 0) * 0.19)
    ) reject("planOrTotals");
  });
  const debitRef = drafts[8]?.references?.[0];
  const creditRef = drafts[9]?.references?.[0];
  if (
    debitRef?.documentType !== "33" ||
    debitRef.folio !== "9" ||
    debitRef.date !== drafts[0]?.issueDate ||
    debitRef.code !== "3" ||
    creditRef?.documentType !== "33" ||
    creditRef.folio !== "10" ||
    creditRef.date !== drafts[1]?.issueDate ||
    creditRef.code !== "3" ||
    String(debitRef.folio) === String(creditRef.folio)
  ) reject("references");
}

export function selectUniqueSimulationCaf<T extends {
  typeCode: number;
  rangeFrom: number;
  rangeTo: number;
}>(cafs: readonly T[], typeCode: number, folio: number): T {
  const matches = cafs.filter(
    (caf) =>
      caf.typeCode === typeCode &&
      caf.rangeFrom <= folio &&
      caf.rangeTo >= folio,
  );
  if (matches.length !== 1) reject("cafCoverageUnique");
  return matches[0];
}
