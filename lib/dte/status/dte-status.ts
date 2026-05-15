export const DTE_STATUSES = [
  "draft",
  "xml_generated",
  "signed",
  "submitted",
  "accepted",
  "accepted_with_observations",
  "rejected",
  "cancelled",
  "failed",
] as const;

export type DteOperationalStatus = (typeof DTE_STATUSES)[number];

const FINAL_STATUSES = new Set<DteOperationalStatus>([
  "accepted",
  "accepted_with_observations",
  "rejected",
  "cancelled",
  "failed",
]);

const ALLOWED_TRANSITIONS: Record<DteOperationalStatus, DteOperationalStatus[]> = {
  draft: ["xml_generated", "cancelled", "failed"],
  xml_generated: ["signed", "cancelled", "failed"],
  signed: ["submitted", "failed"],
  submitted: ["accepted", "accepted_with_observations", "rejected", "failed"],
  accepted: [],
  accepted_with_observations: [],
  rejected: [],
  cancelled: [],
  failed: [],
};

const STATUS_LABELS: Record<DteOperationalStatus, string> = {
  draft: "Borrador",
  xml_generated: "XML generado",
  signed: "Firmado",
  submitted: "Enviado a SII",
  accepted: "Aceptado por SII",
  accepted_with_observations: "Aceptado con observaciones",
  rejected: "Rechazado por SII",
  cancelled: "Anulado",
  failed: "Fallido",
};

const STATUS_DESCRIPTIONS: Record<DteOperationalStatus, string> = {
  draft: "Documento interno creado; todavia no consume emision real.",
  xml_generated: "XML construido y listo para firma controlada.",
  signed: "XML firmado; no debe reutilizar folio sin trazabilidad.",
  submitted: "Set enviado a SII y esperando track_id/estado.",
  accepted: "SII acepto el documento. Requiere evidencia real de ambiente SII.",
  accepted_with_observations:
    "SII acepto el documento con observaciones que deben auditarse.",
  rejected: "SII rechazo el documento; requiere correccion y trazabilidad.",
  cancelled: "Documento anulado antes de completar emision.",
  failed: "Flujo fallo; revisar evento y punto exacto de falla.",
};

export function isDteOperationalStatus(
  value: string,
): value is DteOperationalStatus {
  return DTE_STATUSES.includes(value as DteOperationalStatus);
}

export function canTransitionDteStatus(
  from: DteOperationalStatus,
  to: DteOperationalStatus,
): boolean {
  if (from === to) return true;
  if (FINAL_STATUSES.has(from)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidDteStatusTransition(
  from: DteOperationalStatus,
  to: DteOperationalStatus,
): void {
  if (!canTransitionDteStatus(from, to)) {
    throw new Error(`Invalid DTE status transition: ${from} -> ${to}`);
  }
}

export function getDteStatusLabel(status: DteOperationalStatus): string {
  return STATUS_LABELS[status];
}

export function getDteStatusDescription(status: DteOperationalStatus): string {
  return STATUS_DESCRIPTIONS[status];
}
