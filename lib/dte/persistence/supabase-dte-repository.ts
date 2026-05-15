import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
import type {
  DteRepository,
  MarkSignedInput,
  MarkXmlGeneratedInput,
  UpdateSiiSubmissionStatusInput,
} from "./dte-repository";

export const DTE_SUPABASE_PERSISTENCE_NOT_READY =
  "DTE_SUPABASE_PERSISTENCE_NOT_READY";

type DbResult<T> = {
  data: T | null;
  error: { message?: string; code?: string } | null;
};

type SupabaseLike = Pick<SupabaseClient, "from">;

type TaxDocumentRow = {
  id: string;
  tenant_id: string;
  document_type: TaxDocumentRecord["documentType"];
  folio: number;
  status: TaxDocumentRecord["status"];
  sii_status: DteSiiStatus;
  emitter_rut: string;
  emitter_name: string;
  receiver_rut: string;
  receiver_name: string;
  issue_date: string;
  total_amount: number;
  net_amount: number | null;
  tax_amount: number | null;
  exempt_amount: number | null;
  appointment_id: string | null;
  payment_id: string | null;
  payment_reference: string | null;
  xml_storage_path: string | null;
  xml_sha256: string | null;
  pdf_storage_path: string | null;
  created_at: string;
  updated_at: string;
};

type SubmissionRow = {
  id: string;
  tenant_id: string;
  tax_document_id: string;
  environment: TaxDocumentSubmissionRecord["environment"];
  track_id: string | null;
  submission_status: TaxDocumentSubmissionRecord["submissionStatus"];
  sii_status: DteSiiStatus;
  request_xml_sha256: string | null;
  response_sha256: string | null;
  raw_response_redacted: TaxDocumentSubmissionRecord["rawResponseRedacted"];
  token_fingerprint: string | null;
  submitted_at: string | null;
  checked_at: string | null;
  created_at: string;
};

type StatusHistoryRow = {
  id: string;
  tenant_id: string;
  tax_document_id: string;
  submission_id: string | null;
  previous_status: DteOperationalStatus | null;
  next_status: DteOperationalStatus;
  previous_sii_status: DteSiiStatus | null;
  next_sii_status: DteSiiStatus;
  reason: string;
  source: TaxDocumentStatusHistoryRecord["source"];
  created_by: string | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  tenant_id: string;
  tax_document_id: string | null;
  submission_id: string | null;
  action: string;
  actor_type: TaxDocumentAuditRecord["actorType"];
  actor_id: string | null;
  metadata_redacted: Record<string, unknown>;
  ip_hash: string | null;
  created_at: string;
};

export class DteSupabasePersistenceNotReadyError extends Error {
  constructor(message: string) {
    super(`${DTE_SUPABASE_PERSISTENCE_NOT_READY}: ${message}`);
    this.name = "DteSupabasePersistenceNotReadyError";
  }
}

export class SupabaseDteRepository implements DteRepository {
  private readonly client: SupabaseLike;

  constructor(client?: SupabaseLike) {
    this.client = client ?? createSupabaseAdminClientFromEnv();
  }

  async createTaxDocumentDraft(
    draft: TaxDocumentDraftPersistence,
  ): Promise<DtePersistenceResult<TaxDocumentRecord>> {
    const now = new Date().toISOString();
    const row: TaxDocumentRow = {
      id: randomUUID(),
      tenant_id: draft.tenantId,
      document_type: draft.documentType,
      folio: draft.folio,
      status: "draft",
      sii_status: "not_sent",
      emitter_rut: draft.emitterRut,
      emitter_name: draft.emitterName,
      receiver_rut: draft.receiverRut,
      receiver_name: draft.receiverName,
      issue_date: draft.issueDate,
      total_amount: draft.totalAmount,
      net_amount: draft.netAmount ?? null,
      tax_amount: draft.taxAmount ?? null,
      exempt_amount: draft.exemptAmount ?? null,
      appointment_id: draft.appointmentId ?? null,
      payment_id: draft.paymentId ?? null,
      payment_reference: draft.paymentReference ?? null,
      xml_storage_path: null,
      xml_sha256: null,
      pdf_storage_path: null,
      created_at: now,
      updated_at: now,
    };

    const result = (await this.client
      .from("tax_documents")
      .insert(row)
      .select()
      .single()) as DbResult<TaxDocumentRow>;

    if (result.error) return failure(result.error);
    return { ok: true, record: mapTaxDocumentRow(result.data ?? row) };
  }

  async markXmlGenerated(
    input: MarkXmlGeneratedInput,
  ): Promise<DtePersistenceResult<TaxDocumentRecord>> {
    return this.updateDocument(input.taxDocumentId, {
      status: "xml_generated",
      xml_sha256: sha256String(input.xml),
      xml_storage_path: input.xmlStoragePath ?? null,
    });
  }

  async markSigned(input: MarkSignedInput): Promise<DtePersistenceResult<TaxDocumentRecord>> {
    return this.updateDocument(input.taxDocumentId, {
      status: "signed",
      ...(input.signedXml ? { xml_sha256: sha256String(input.signedXml) } : {}),
    });
  }

  async createSiiSubmission(
    submission: TaxDocumentSubmissionRecord,
  ): Promise<DtePersistenceResult<TaxDocumentSubmissionRecord>> {
    const row = submissionToRow(submission);
    const result = (await this.client
      .from("tax_document_sii_submissions")
      .insert(row)
      .select()
      .single()) as DbResult<SubmissionRow>;

    if (result.error) return failure(result.error);
    return { ok: true, record: mapSubmissionRow(result.data ?? row) };
  }

  async updateSiiSubmissionStatus(
    input: UpdateSiiSubmissionStatusInput,
  ): Promise<DtePersistenceResult<TaxDocumentSubmissionRecord>> {
    const patch = {
      submission_status: input.submissionStatus,
      sii_status: input.siiStatus,
      track_id: input.trackId ?? null,
      response_sha256: input.responseSha256 ?? null,
      raw_response_redacted: input.rawResponseRedacted ?? null,
      checked_at: input.checkedAt ?? new Date().toISOString(),
    };

    const result = (await this.client
      .from("tax_document_sii_submissions")
      .update(patch)
      .eq("id", input.submissionId)
      .select()
      .single()) as DbResult<SubmissionRow>;

    if (result.error) return failure(result.error);
    if (!result.data) return failure("submission update did not return a row");
    const record = mapSubmissionRow(result.data);

    const nextStatus = mapSubmissionStatusToDocumentStatus(
      record.submissionStatus,
      input.siiStatus,
    );
    await this.client
      .from("tax_documents")
      .update({
        status: nextStatus,
        sii_status: input.siiStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.taxDocumentId)
      .eq("tenant_id", record.tenantId);

    return { ok: true, record };
  }

  async appendStatusHistory(
    history: TaxDocumentStatusHistoryRecord,
  ): Promise<DtePersistenceResult<TaxDocumentStatusHistoryRecord>> {
    const row: StatusHistoryRow = {
      id: history.id,
      tenant_id: history.tenantId,
      tax_document_id: history.taxDocumentId,
      submission_id: history.submissionId ?? null,
      previous_status: history.previousStatus ?? null,
      next_status: history.nextStatus,
      previous_sii_status: history.previousSiiStatus ?? null,
      next_sii_status: history.nextSiiStatus,
      reason: history.reason,
      source: history.source,
      created_by: history.createdBy ?? null,
      created_at: history.createdAt,
    };
    const result = (await this.client
      .from("tax_document_status_history")
      .insert(row)
      .select()
      .single()) as DbResult<StatusHistoryRow>;

    if (result.error) return failure(result.error);
    return { ok: true, record: mapStatusHistoryRow(result.data ?? row) };
  }

  async appendAuditLog(
    audit: TaxDocumentAuditRecord,
  ): Promise<DtePersistenceResult<TaxDocumentAuditRecord>> {
    const row: AuditRow = {
      id: audit.id,
      tenant_id: audit.tenantId,
      tax_document_id: audit.taxDocumentId ?? null,
      submission_id: audit.submissionId ?? null,
      action: audit.action,
      actor_type: audit.actorType,
      actor_id: audit.actorId ?? null,
      metadata_redacted: audit.metadataRedacted,
      ip_hash: audit.ipHash ?? null,
      created_at: audit.createdAt,
    };
    const result = (await this.client
      .from("tax_document_audit_log")
      .insert(row)
      .select()
      .single()) as DbResult<AuditRow>;

    if (result.error) return failure(result.error);
    return { ok: true, record: mapAuditRow(result.data ?? row) };
  }

  async findByTrackId(trackId: string): Promise<TaxDocumentSubmissionRecord | null> {
    const result = (await this.client
      .from("tax_document_sii_submissions")
      .select()
      .eq("track_id", trackId)
      .maybeSingle()) as DbResult<SubmissionRow>;
    if (result.error) throw notReady(result.error);
    return result.data ? mapSubmissionRow(result.data) : null;
  }

  async findByDocumentReference(reference: {
    tenantId: string;
    paymentReference?: string | null;
    paymentId?: string | null;
    appointmentId?: string | null;
  }): Promise<TaxDocumentRecord | null> {
    let query = this.client
      .from("tax_documents")
      .select()
      .eq("tenant_id", reference.tenantId);

    if (reference.paymentReference) {
      query = query.eq("payment_reference", reference.paymentReference);
    } else if (reference.paymentId) {
      query = query.eq("payment_id", reference.paymentId);
    } else if (reference.appointmentId) {
      query = query.eq("appointment_id", reference.appointmentId);
    } else {
      return null;
    }

    const result = (await query.maybeSingle()) as DbResult<TaxDocumentRow>;
    if (result.error) throw notReady(result.error);
    return result.data ? mapTaxDocumentRow(result.data) : null;
  }

  async findByTenantAndFolio(input: {
    tenantId: string;
    documentType: string;
    folio: number;
  }): Promise<TaxDocumentRecord | null> {
    const result = (await this.client
      .from("tax_documents")
      .select()
      .eq("tenant_id", input.tenantId)
      .eq("document_type", input.documentType)
      .eq("folio", input.folio)
      .maybeSingle()) as DbResult<TaxDocumentRow>;
    if (result.error) throw notReady(result.error);
    return result.data ? mapTaxDocumentRow(result.data) : null;
  }

  async listRecentByTenant(input: {
    tenantId: string;
    limit?: number;
    status?: TaxDocumentRecord["status"];
    siiStatus?: DteSiiStatus;
  }): Promise<TaxDocumentRecord[]> {
    let query = this.client
      .from("tax_documents")
      .select()
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 25);
    if (input.status) query = query.eq("status", input.status);
    if (input.siiStatus) query = query.eq("sii_status", input.siiStatus);

    const result = (await query) as { data: TaxDocumentRow[] | null; error: unknown };
    if (result.error) throw notReady(result.error);
    return (result.data ?? []).map(mapTaxDocumentRow);
  }

  async listSubmissionsByTenant(input: {
    tenantId: string;
    limit?: number;
    environment?: TaxDocumentSubmissionRecord["environment"];
    siiStatus?: DteSiiStatus;
  }): Promise<TaxDocumentSubmissionRecord[]> {
    let query = this.client
      .from("tax_document_sii_submissions")
      .select()
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 25);
    if (input.environment) query = query.eq("environment", input.environment);
    if (input.siiStatus) query = query.eq("sii_status", input.siiStatus);

    const result = (await query) as { data: SubmissionRow[] | null; error: unknown };
    if (result.error) throw notReady(result.error);
    return (result.data ?? []).map(mapSubmissionRow);
  }

  async listAuditLogByTenant(input: {
    tenantId: string;
    limit?: number;
  }): Promise<TaxDocumentAuditRecord[]> {
    const result = (await this.client
      .from("tax_document_audit_log")
      .select()
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 25)) as { data: AuditRow[] | null; error: unknown };
    if (result.error) throw notReady(result.error);
    return (result.data ?? []).map(mapAuditRow);
  }

  async findTaxDocumentById(input: {
    tenantId: string;
    id: string;
  }): Promise<TaxDocumentRecord | null> {
    const result = (await this.client
      .from("tax_documents")
      .select()
      .eq("tenant_id", input.tenantId)
      .eq("id", input.id)
      .maybeSingle()) as DbResult<TaxDocumentRow>;
    if (result.error) throw notReady(result.error);
    return result.data ? mapTaxDocumentRow(result.data) : null;
  }

  private async updateDocument(
    taxDocumentId: string,
    patch: Partial<TaxDocumentRow>,
  ): Promise<DtePersistenceResult<TaxDocumentRecord>> {
    const result = (await this.client
      .from("tax_documents")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", taxDocumentId)
      .select()
      .single()) as DbResult<TaxDocumentRow>;

    if (result.error) return failure(result.error);
    if (!result.data) return failure("tax document update did not return a row");
    return { ok: true, record: mapTaxDocumentRow(result.data) };
  }
}

function createSupabaseAdminClientFromEnv(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRole) {
    throw new DteSupabasePersistenceNotReadyError(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY; no se activa persistencia Supabase.",
    );
  }

  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function failure<T>(error: unknown): DtePersistenceResult<T> {
  return { ok: false, error: notReady(error).message };
}

function notReady(error: unknown): DteSupabasePersistenceNotReadyError {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  return new DteSupabasePersistenceNotReadyError(
    `${message || "migracion/tablas DTE no disponibles"}; aplicar docs/dte-sii/DTE_SUPABASE_MIGRATION.sql manualmente.`,
  );
}

function mapTaxDocumentRow(row: TaxDocumentRow): TaxDocumentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    documentType: row.document_type,
    folio: row.folio,
    status: row.status,
    siiStatus: row.sii_status,
    emitterRut: row.emitter_rut,
    emitterName: row.emitter_name,
    receiverRut: row.receiver_rut,
    receiverName: row.receiver_name,
    issueDate: row.issue_date,
    totalAmount: row.total_amount,
    netAmount: row.net_amount,
    taxAmount: row.tax_amount,
    exemptAmount: row.exempt_amount,
    appointmentId: row.appointment_id,
    paymentId: row.payment_id,
    paymentReference: row.payment_reference,
    xmlStoragePath: row.xml_storage_path,
    xmlSha256: row.xml_sha256,
    pdfStoragePath: row.pdf_storage_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function submissionToRow(record: TaxDocumentSubmissionRecord): SubmissionRow {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    tax_document_id: record.taxDocumentId,
    environment: record.environment,
    track_id: record.trackId ?? null,
    submission_status: record.submissionStatus,
    sii_status: record.siiStatus,
    request_xml_sha256: record.requestXmlSha256 ?? null,
    response_sha256: record.responseSha256 ?? null,
    raw_response_redacted: record.rawResponseRedacted ?? null,
    token_fingerprint: record.tokenFingerprint ?? null,
    submitted_at: record.submittedAt ?? null,
    checked_at: record.checkedAt ?? null,
    created_at: record.createdAt,
  };
}

function mapSubmissionRow(row: SubmissionRow): TaxDocumentSubmissionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taxDocumentId: row.tax_document_id,
    environment: row.environment,
    trackId: row.track_id,
    submissionStatus: row.submission_status,
    siiStatus: row.sii_status,
    requestXmlSha256: row.request_xml_sha256,
    responseSha256: row.response_sha256,
    rawResponseRedacted: row.raw_response_redacted,
    tokenFingerprint: row.token_fingerprint,
    submittedAt: row.submitted_at,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
  };
}

function mapStatusHistoryRow(row: StatusHistoryRow): TaxDocumentStatusHistoryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taxDocumentId: row.tax_document_id,
    submissionId: row.submission_id,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    previousSiiStatus: row.previous_sii_status,
    nextSiiStatus: row.next_sii_status,
    reason: row.reason,
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapAuditRow(row: AuditRow): TaxDocumentAuditRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taxDocumentId: row.tax_document_id,
    submissionId: row.submission_id,
    action: row.action,
    actorType: row.actor_type,
    actorId: row.actor_id,
    metadataRedacted: row.metadata_redacted,
    ipHash: row.ip_hash,
    createdAt: row.created_at,
  };
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
