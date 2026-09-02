import type { DteOperationalStatus } from "../status/dte-status";
import { sha256String } from "./dte-hash";
import type {
  DtePersistenceResult,
  DteSiiStatus,
  TaxDocumentAuditRecord,
  TaxDocumentDraftPersistence,
  TaxDocumentRecord,
  TaxDocumentStatusHistoryRecord,
  TaxDocumentSubmissionRecord,
} from "./dte-persistence-types";

export type MarkXmlGeneratedInput = {
  tenantId: string;
  taxDocumentId: string;
  xml: string;
  xmlStoragePath?: string | null;
};

export type MarkSignedInput = {
  tenantId: string;
  taxDocumentId: string;
  signedXml?: string | null;
};

export type UpdateSiiSubmissionStatusInput = {
  tenantId: string;
  submissionId: string;
  submissionStatus: TaxDocumentSubmissionRecord["submissionStatus"];
  siiStatus: DteSiiStatus;
  trackId?: string | null;
  responseSha256?: string | null;
  rawResponseRedacted?: TaxDocumentSubmissionRecord["rawResponseRedacted"];
  checkedAt?: string | null;
};

export interface DteRepository {
  createTaxDocumentDraft(
    draft: TaxDocumentDraftPersistence,
  ): Promise<DtePersistenceResult<TaxDocumentRecord>>;
  markXmlGenerated(
    input: MarkXmlGeneratedInput,
  ): Promise<DtePersistenceResult<TaxDocumentRecord>>;
  markSigned(input: MarkSignedInput): Promise<DtePersistenceResult<TaxDocumentRecord>>;
  createSiiSubmission(
    submission: TaxDocumentSubmissionRecord,
  ): Promise<DtePersistenceResult<TaxDocumentSubmissionRecord>>;
  updateSiiSubmissionStatus(
    input: UpdateSiiSubmissionStatusInput,
  ): Promise<DtePersistenceResult<TaxDocumentSubmissionRecord>>;
  appendStatusHistory(
    history: TaxDocumentStatusHistoryRecord,
  ): Promise<DtePersistenceResult<TaxDocumentStatusHistoryRecord>>;
  appendAuditLog(
    audit: TaxDocumentAuditRecord,
  ): Promise<DtePersistenceResult<TaxDocumentAuditRecord>>;
  findByTrackId(input: {
    tenantId: string;
    trackId: string;
  }): Promise<TaxDocumentSubmissionRecord | null>;
  findTaxDocumentById(input: {
    tenantId: string;
    id: string;
  }): Promise<TaxDocumentRecord | null>;
  findByDocumentReference(reference: {
    tenantId: string;
    paymentReference?: string | null;
    paymentId?: string | null;
    appointmentId?: string | null;
  }): Promise<TaxDocumentRecord | null>;
  findByTenantAndFolio(input: {
    tenantId: string;
    documentType: string;
    folio: number;
  }): Promise<TaxDocumentRecord | null>;
  listRecentByTenant(input: {
    tenantId: string;
    limit?: number;
    status?: TaxDocumentRecord["status"];
    siiStatus?: DteSiiStatus;
  }): Promise<TaxDocumentRecord[]>;
  listSubmissionsByTenant(input: {
    tenantId: string;
    limit?: number;
    environment?: TaxDocumentSubmissionRecord["environment"];
    siiStatus?: DteSiiStatus;
  }): Promise<TaxDocumentSubmissionRecord[]>;
  listAuditLogByTenant(input: {
    tenantId: string;
    limit?: number;
  }): Promise<TaxDocumentAuditRecord[]>;
}

export class InMemoryDteRepository implements DteRepository {
  taxDocuments: TaxDocumentRecord[] = [];
  submissions: TaxDocumentSubmissionRecord[] = [];
  statusHistory: TaxDocumentStatusHistoryRecord[] = [];
  auditLog: TaxDocumentAuditRecord[] = [];

  async createTaxDocumentDraft(
    draft: TaxDocumentDraftPersistence,
  ): Promise<DtePersistenceResult<TaxDocumentRecord>> {
    if (!draft.tenantId.trim()) return { ok: false, error: "tenantId requerido" };

    const duplicate = await this.findByTenantAndFolio({
      tenantId: draft.tenantId,
      documentType: draft.documentType,
      folio: draft.folio,
    });
    if (duplicate) {
      return { ok: false, error: "Duplicate tenant/document_type/folio" };
    }

    const byReference = await this.findByDocumentReference({
      tenantId: draft.tenantId,
      paymentReference: draft.paymentReference,
      paymentId: draft.paymentId,
      appointmentId: draft.appointmentId,
    });
    if (byReference) {
      return { ok: false, error: "Duplicate document reference" };
    }

    const now = new Date().toISOString();
    const record: TaxDocumentRecord = {
      ...draft,
      id: `taxdoc_${sha256String(`${draft.tenantId}:${draft.documentType}:${draft.folio}`).slice(0, 16)}`,
      status: "draft",
      siiStatus: "not_sent",
      createdAt: now,
      updatedAt: now,
    };
    this.taxDocuments.push(record);
    return { ok: true, record };
  }

  async markXmlGenerated(
    input: MarkXmlGeneratedInput,
  ): Promise<DtePersistenceResult<TaxDocumentRecord>> {
    return this.updateDocument(input.tenantId, input.taxDocumentId, {
      status: "xml_generated",
      xmlSha256: sha256String(input.xml),
      xmlStoragePath: input.xmlStoragePath ?? null,
    });
  }

  async markSigned(input: MarkSignedInput): Promise<DtePersistenceResult<TaxDocumentRecord>> {
    return this.updateDocument(input.tenantId, input.taxDocumentId, {
      status: "signed",
      xmlSha256: input.signedXml ? sha256String(input.signedXml) : undefined,
    });
  }

  async createSiiSubmission(
    submission: TaxDocumentSubmissionRecord,
  ): Promise<DtePersistenceResult<TaxDocumentSubmissionRecord>> {
    if (
      submission.trackId &&
      this.submissions.some(
        (item) => item.tenantId === submission.tenantId && item.trackId === submission.trackId,
      )
    ) {
      return { ok: false, error: "Duplicate track_id for tenant" };
    }

    this.submissions.push(submission);
    return { ok: true, record: submission };
  }

  async updateSiiSubmissionStatus(
    input: UpdateSiiSubmissionStatusInput,
  ): Promise<DtePersistenceResult<TaxDocumentSubmissionRecord>> {
    if (!input.tenantId.trim()) return { ok: false, error: "tenantId requerido" };
    const submission = this.submissions.find(
      (item) => item.id === input.submissionId && item.tenantId === input.tenantId,
    );
    if (!submission) return { ok: false, error: "Submission not found" };

    submission.submissionStatus = input.submissionStatus;
    submission.siiStatus = input.siiStatus;
    submission.trackId = input.trackId ?? submission.trackId;
    submission.responseSha256 = input.responseSha256 ?? submission.responseSha256;
    submission.rawResponseRedacted =
      input.rawResponseRedacted ?? submission.rawResponseRedacted;
    submission.checkedAt = input.checkedAt ?? submission.checkedAt;

    const document = this.taxDocuments.find(
      (item) => item.id === submission.taxDocumentId && item.tenantId === input.tenantId,
    );
    if (document) {
      document.siiStatus = input.siiStatus;
      document.status = mapSubmissionStatusToDocumentStatus(
        input.submissionStatus,
        input.siiStatus,
      );
      document.updatedAt = new Date().toISOString();
    }

    return { ok: true, record: submission };
  }

  async appendStatusHistory(
    history: TaxDocumentStatusHistoryRecord,
  ): Promise<DtePersistenceResult<TaxDocumentStatusHistoryRecord>> {
    this.statusHistory.push(history);
    return { ok: true, record: history };
  }

  async appendAuditLog(
    audit: TaxDocumentAuditRecord,
  ): Promise<DtePersistenceResult<TaxDocumentAuditRecord>> {
    this.auditLog.push(audit);
    return { ok: true, record: audit };
  }

  async findByTrackId(input: {
    tenantId: string;
    trackId: string;
  }): Promise<TaxDocumentSubmissionRecord | null> {
    if (!input.tenantId.trim()) return null;
    return (
      this.submissions.find(
        (item) => item.tenantId === input.tenantId && item.trackId === input.trackId,
      ) ?? null
    );
  }

  async findTaxDocumentById(input: {
    tenantId: string;
    id: string;
  }): Promise<TaxDocumentRecord | null> {
    if (!input.tenantId.trim()) return null;
    return (
      this.taxDocuments.find(
        (item) => item.tenantId === input.tenantId && item.id === input.id,
      ) ?? null
    );
  }

  async findByDocumentReference(reference: {
    tenantId: string;
    paymentReference?: string | null;
    paymentId?: string | null;
    appointmentId?: string | null;
  }): Promise<TaxDocumentRecord | null> {
    return (
      this.taxDocuments.find(
        (item) =>
          item.tenantId === reference.tenantId &&
          ((reference.paymentReference &&
            item.paymentReference === reference.paymentReference) ||
            (reference.paymentId && item.paymentId === reference.paymentId) ||
            (reference.appointmentId && item.appointmentId === reference.appointmentId)),
      ) ?? null
    );
  }

  async findByTenantAndFolio(input: {
    tenantId: string;
    documentType: string;
    folio: number;
  }): Promise<TaxDocumentRecord | null> {
    return (
      this.taxDocuments.find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.documentType === input.documentType &&
          item.folio === input.folio,
      ) ?? null
    );
  }

  async listRecentByTenant(input: {
    tenantId: string;
    limit?: number;
    status?: TaxDocumentRecord["status"];
    siiStatus?: DteSiiStatus;
  }): Promise<TaxDocumentRecord[]> {
    if (!input.tenantId.trim()) return [];
    return this.taxDocuments
      .filter(
        (item) =>
          item.tenantId === input.tenantId &&
          (!input.status || item.status === input.status) &&
          (!input.siiStatus || item.siiStatus === input.siiStatus),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 25);
  }

  async listSubmissionsByTenant(input: {
    tenantId: string;
    limit?: number;
    environment?: TaxDocumentSubmissionRecord["environment"];
    siiStatus?: DteSiiStatus;
  }): Promise<TaxDocumentSubmissionRecord[]> {
    if (!input.tenantId.trim()) return [];
    return this.submissions
      .filter(
        (item) =>
          item.tenantId === input.tenantId &&
          (!input.environment || item.environment === input.environment) &&
          (!input.siiStatus || item.siiStatus === input.siiStatus),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 25);
  }

  async listAuditLogByTenant(input: {
    tenantId: string;
    limit?: number;
  }): Promise<TaxDocumentAuditRecord[]> {
    if (!input.tenantId.trim()) return [];
    return this.auditLog
      .filter((item) => item.tenantId === input.tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 25);
  }

  private async updateDocument(
    tenantId: string,
    taxDocumentId: string,
    patch: Partial<
      Pick<
        TaxDocumentRecord,
        "status" | "siiStatus" | "xmlSha256" | "xmlStoragePath" | "pdfStoragePath"
      >
    >,
  ): Promise<DtePersistenceResult<TaxDocumentRecord>> {
    if (!tenantId.trim()) return { ok: false, error: "tenantId requerido" };
    const record = this.taxDocuments.find(
      (item) => item.id === taxDocumentId && item.tenantId === tenantId,
    );
    if (!record) return { ok: false, error: "Tax document not found" };
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    return { ok: true, record };
  }
}

function mapSubmissionStatusToDocumentStatus(
  submissionStatus: TaxDocumentSubmissionRecord["submissionStatus"],
  siiStatus: DteSiiStatus,
): DteOperationalStatus {
  if (siiStatus === "accepted") return "accepted";
  if (siiStatus === "accepted_with_observations") return "accepted_with_observations";
  if (siiStatus === "rejected") return "rejected";
  if (submissionStatus === "submitted" || siiStatus === "sent" || siiStatus === "processing") {
    return "submitted";
  }
  if (submissionStatus === "failed" || siiStatus === "failed") return "failed";
  return "signed";
}
