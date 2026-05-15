import type { DteDocumentType } from "../dte-types";
import type { DteOperationalStatus } from "../status/dte-status";
import type { SiiCertificationStatus } from "../sii/sii-types";

export type DtePersistenceEnvironment = "lab" | "certification" | "production";
export type DtePersistenceSource = "system" | "admin" | "sii" | "webhook" | "script";
export type DteAuditActorType = "system" | "admin" | "tenant_user" | "script";

export type DteSiiStatus =
  | "not_sent"
  | "sent"
  | "processing"
  | "accepted"
  | "accepted_with_observations"
  | "rejected"
  | "unknown"
  | "failed";

export type RedactedSiiResponse = {
  redacted: true;
  status?: string | null;
  trackId?: string | null;
  message?: string | null;
  keys: string[];
  sha256: string;
};

export type TaxDocumentDraftPersistence = {
  tenantId: string;
  documentType: DteDocumentType;
  folio: number;
  emitterRut: string;
  emitterName: string;
  receiverRut: string;
  receiverName: string;
  issueDate: string;
  totalAmount: number;
  netAmount?: number | null;
  taxAmount?: number | null;
  exemptAmount?: number | null;
  appointmentId?: string | null;
  paymentId?: string | null;
  paymentReference?: string | null;
};

export type TaxDocumentRecord = TaxDocumentDraftPersistence & {
  id: string;
  status: DteOperationalStatus;
  siiStatus: DteSiiStatus;
  xmlStoragePath?: string | null;
  xmlSha256?: string | null;
  pdfStoragePath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaxDocumentSubmissionRecord = {
  id: string;
  tenantId: string;
  taxDocumentId: string;
  environment: DtePersistenceEnvironment;
  trackId?: string | null;
  submissionStatus: "draft" | "dry_run" | "blocked" | "submitted" | "failed";
  siiStatus: DteSiiStatus;
  requestXmlSha256?: string | null;
  responseSha256?: string | null;
  rawResponseRedacted?: RedactedSiiResponse | null;
  tokenFingerprint?: string | null;
  submittedAt?: string | null;
  checkedAt?: string | null;
  createdAt: string;
};

export type TaxDocumentStatusHistoryRecord = {
  id: string;
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
  createdAt: string;
};

export type TaxDocumentAuditRecord = {
  id: string;
  tenantId: string;
  taxDocumentId?: string | null;
  submissionId?: string | null;
  action: string;
  actorType: DteAuditActorType;
  actorId?: string | null;
  metadataRedacted: Record<string, unknown>;
  ipHash?: string | null;
  createdAt: string;
};

export type DtePersistenceResult<T> =
  | { ok: true; record: T }
  | { ok: false; error: string };

export type DtePersistenceTraceSummary = {
  environment: DtePersistenceEnvironment;
  dryRun: boolean;
  xmlSha256: string | null;
  status: DteOperationalStatus;
  siiStatus: DteSiiStatus;
  trackId: string | null;
  generatedAt: string;
  readiness: {
    globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO";
    labScore: number;
    certificationScore: number;
    productionTechnicalScore: number;
  };
  redactedConfig: Record<string, unknown>;
  lastAuditAction?: string | null;
};

export function mapCertificationStatusToSiiStatus(
  status: SiiCertificationStatus,
): DteSiiStatus {
  if (status === "sent") return "sent";
  if (status === "processing") return "processing";
  if (status === "accepted") return "accepted";
  if (status === "accepted_with_observations") return "accepted_with_observations";
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  return "unknown";
}
