import { assertValidDteStatusTransition } from "../status/dte-status";
import { sha256String } from "./dte-hash";
import type {
  DtePersistenceSource,
  DteSiiStatus,
  TaxDocumentStatusHistoryRecord,
} from "./dte-persistence-types";
import type { DteOperationalStatus } from "../status/dte-status";

export type BuildStatusHistoryInput = {
  tenantId: string;
  taxDocumentId: string;
  submissionId?: string | null;
  previousStatus?: DteOperationalStatus | null;
  nextStatus: DteOperationalStatus;
  previousSiiStatus?: DteSiiStatus | null;
  nextSiiStatus: DteSiiStatus;
  reason: string;
  source: DtePersistenceSource;
  createdBy?: string | null;
  now?: string;
};

export function buildStatusHistoryRecord(
  input: BuildStatusHistoryInput,
): TaxDocumentStatusHistoryRecord {
  if (input.previousStatus) {
    assertValidDteStatusTransition(input.previousStatus, input.nextStatus);
  }

  return {
    id: `status_${sha256String(`${input.tenantId}:${input.taxDocumentId}:${input.nextStatus}:${input.now ?? Date.now()}`).slice(0, 16)}`,
    tenantId: input.tenantId,
    taxDocumentId: input.taxDocumentId,
    submissionId: input.submissionId ?? null,
    previousStatus: input.previousStatus ?? null,
    nextStatus: input.nextStatus,
    previousSiiStatus: input.previousSiiStatus ?? null,
    nextSiiStatus: input.nextSiiStatus,
    reason: input.reason,
    source: input.source,
    createdBy: input.createdBy ?? null,
    createdAt: input.now ?? new Date().toISOString(),
  };
}
