import type { DteFolioLedgerEntry } from "./reserve-folio";

export function releaseReservedFolio(
  ledger: DteFolioLedgerEntry[],
  reserved: DteFolioLedgerEntry,
  reason: "xml_generation_failed" | "validation_failed" | "manual_abort",
  now = new Date().toISOString(),
): { released: DteFolioLedgerEntry; ledger: DteFolioLedgerEntry[] } {
  if (reserved.status !== "reserved") {
    throw new Error("Only reserved DTE folios can be released");
  }

  if (reserved.documentId || reserved.usedAt) {
    throw new Error("Signed or used DTE folios cannot be released");
  }

  const released: DteFolioLedgerEntry = {
    ...reserved,
    status: "available",
    reservedAt: null,
    reservedBy: null,
    appointmentId: null,
    paymentId: null,
    documentReference: null,
    releasedAt: `${now}:${reason}`,
  };

  return {
    released,
    ledger: ledger.map((entry) =>
      entry.tenantId === reserved.tenantId &&
      entry.documentType === reserved.documentType &&
      entry.folio === reserved.folio
        ? released
        : entry,
    ),
  };
}
