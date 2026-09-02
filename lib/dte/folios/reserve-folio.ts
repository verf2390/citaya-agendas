import type { DteDocumentType } from "../dte-types";

export type DteFolioStatus =
  | "available"
  | "reserved"
  | "used"
  | "voided"
  | "expired";

export type DteFolioLedgerEntry = {
  tenantId: string;
  documentType: DteDocumentType;
  folio: number;
  status: DteFolioStatus;
  reservedBy?: string | null;
  documentId?: string | null;
  appointmentId?: string | null;
  paymentId?: string | null;
  documentReference?: string | null;
  reservedAt?: string | null;
  usedAt?: string | null;
  releasedAt?: string | null;
};

export type ReserveFolioInput = {
  tenantId: string;
  documentType: DteDocumentType;
  candidateFolios: DteFolioLedgerEntry[];
  documentReference?: string | null;
  appointmentId?: string | null;
  paymentId?: string | null;
  reservedBy?: string | null;
  now?: string;
};

export type ReserveFolioResult = {
  reserved: DteFolioLedgerEntry;
  ledger: DteFolioLedgerEntry[];
};

export function reserveFolio(input: ReserveFolioInput): ReserveFolioResult {
  const duplicateReference = input.candidateFolios.find(
    (entry) =>
      input.documentReference &&
      entry.documentReference === input.documentReference &&
      (entry.status === "reserved" || entry.status === "used"),
  );

  if (duplicateReference) {
    throw new Error(
      `DTE folio already reserved or used for reference ${input.documentReference}`,
    );
  }

  const next = input.candidateFolios
    .filter(
      (entry) =>
        entry.tenantId === input.tenantId &&
        entry.documentType === input.documentType &&
        entry.status === "available",
    )
    .sort((a, b) => a.folio - b.folio)[0];

  if (!next) {
    throw new Error("No available DTE folios for tenant/document type");
  }

  const reserved: DteFolioLedgerEntry = {
    ...next,
    status: "reserved",
    reservedAt: input.now ?? new Date().toISOString(),
    reservedBy: input.reservedBy ?? null,
    appointmentId: input.appointmentId ?? null,
    paymentId: input.paymentId ?? null,
    documentReference: input.documentReference ?? null,
  };

  return {
    reserved,
    ledger: input.candidateFolios.map((entry) =>
      entry.folio === next.folio &&
      entry.tenantId === next.tenantId &&
      entry.documentType === next.documentType
        ? reserved
        : entry,
    ),
  };
}
