import { randomUUID } from "node:crypto";

import { sha256String } from "./dte-hash";
import { safeJsonForAudit } from "./dte-redaction";
import type {
  DteAuditActorType,
  TaxDocumentAuditRecord,
} from "./dte-persistence-types";

export type BuildAuditInput = {
  id?: string;
  tenantId: string;
  taxDocumentId?: string | null;
  submissionId?: string | null;
  action: string;
  actorType: DteAuditActorType;
  actorId?: string | null;
  metadata?: unknown;
  ipAddress?: string | null;
  now?: string;
};

export function buildAuditRecord(input: BuildAuditInput): TaxDocumentAuditRecord {
  return {
    id: input.id ?? randomUUID(),
    tenantId: input.tenantId,
    taxDocumentId: input.taxDocumentId ?? null,
    submissionId: input.submissionId ?? null,
    action: input.action,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    metadataRedacted: safeJsonForAudit(input.metadata ?? {}),
    ipHash: input.ipAddress ? sha256String(input.ipAddress) : null,
    createdAt: input.now ?? new Date().toISOString(),
  };
}
