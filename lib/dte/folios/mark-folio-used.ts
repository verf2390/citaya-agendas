import type { DteFolioLedgerEntry } from "./reserve-folio";

export function markFolioUsed(
  ledger: DteFolioLedgerEntry[],
  reserved: DteFolioLedgerEntry,
  documentId: string,
  now = new Date().toISOString(),
): { used: DteFolioLedgerEntry; ledger: DteFolioLedgerEntry[] } {
  if (reserved.status !== "reserved") {
    throw new Error("Only reserved DTE folios can be marked as used");
  }

  const used: DteFolioLedgerEntry = {
    ...reserved,
    status: "used",
    documentId,
    usedAt: now,
  };

  return {
    used,
    ledger: ledger.map((entry) =>
      entry.tenantId === reserved.tenantId &&
      entry.documentType === reserved.documentType &&
      entry.folio === reserved.folio
        ? used
        : entry,
    ),
  };
}
