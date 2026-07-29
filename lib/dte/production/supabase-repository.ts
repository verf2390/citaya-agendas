import { resolve } from "node:path";

import type {
  ProductionDteRepository,
  ReserveProductionFolioInput,
} from "./repository";
import {
  protectProductionValue,
  revealProductionValue,
} from "./sensitive";
import type {
  ProductionArtifact,
  ProductionCafMetadata,
  ProductionDocument,
  ProductionDocumentStatus,
  ProductionDraftInput,
  ProductionDteType,
  ProductionSubmissionAttempt,
  ProductionTenantSettings,
  RecipientOutboxRecord,
  SafeProductionAudit,
} from "./types";

type DbResponse<T> = { data: T | null; error: { message?: string; code?: string } | null };
type Query = {
  select(columns?: string): Query;
  insert(value: unknown): Query;
  update(value: unknown): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  maybeSingle(): Promise<DbResponse<Record<string, unknown>>>;
  single(): Promise<DbResponse<Record<string, unknown>>>;
  then<TResult1 = DbResponse<Record<string, unknown>[]>>(
    onfulfilled?: (value: DbResponse<Record<string, unknown>[]>) => TResult1 | PromiseLike<TResult1>,
  ): Promise<TResult1>;
};
type SupabaseLike = {
  from(table: string): Query;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<DbResponse<Array<Record<string, unknown>>>>;
};

function fail(error: { message?: string; code?: string } | null): never {
  const databaseCode = String(error?.code ?? "")
    .trim()
    .match(/^[A-Z0-9]{5}$/)?.[0] ?? null;
  const cause = databaseCode
    ? Object.assign(new Error(`DATABASE_ERROR_${databaseCode}`), {
        name: "DatabaseError",
        code: databaseCode,
      })
    : undefined;
  const failure = new Error("DTE_PRODUCTION_PERSISTENCE_FAILED", { cause });
  failure.name = "ProductionPersistenceError";
  throw failure;
}

function text(value: unknown): string {
  return String(value ?? "");
}

function number(value: unknown): number {
  return Number(value);
}

function mapSettings(row: Record<string, unknown>, env: NodeJS.ProcessEnv): Omit<ProductionTenantSettings, "autoEmailDelivery"> {
  const certificateRoot = String(env.DTE_PRODUCTION_CERTIFICATE_ROOT ?? "").trim();
  const privateKeyRoot = String(env.DTE_PRODUCTION_PRIVATE_KEY_ROOT ?? "").trim();
  if (!certificateRoot) throw new Error("DTE_PRODUCTION_CERTIFICATE_ROOT_MISSING");
  if (!privateKeyRoot) throw new Error("DTE_PRODUCTION_PRIVATE_KEY_ROOT_MISSING");
  const tenantId = text(row.tenant_id);
  return {
    tenantId,
    enabled: row.enabled === true,
    issuer: {
      rut: text(row.issuer_rut),
      legalName: text(row.issuer_legal_name),
      businessActivity: text(row.issuer_activity),
      businessActivityCode: text(row.issuer_activity_code) || null,
      address: text(row.issuer_address),
      commune: text(row.issuer_commune),
      city: text(row.issuer_city),
      resolutionDate: text(row.resolution_date),
      resolutionNumber: text(row.resolution_number),
      siiOffice: row.sii_office === null ? null : text(row.sii_office),
    },
    senderRut: text(row.sender_rut),
    certificatePath: resolve(certificateRoot, tenantId, "certificate.pem"),
    privateKeyPath: resolve(privateKeyRoot, tenantId, "private-key.pem"),
    certificateValidFrom: text(row.certificate_valid_from),
    certificateValidTo: text(row.certificate_valid_to),
  };
}

function mapCaf(row: Record<string, unknown>): ProductionCafMetadata {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    dteType: number(row.dte_type) as ProductionDteType,
    issuerRut: text(row.issuer_rut),
    rangeFrom: number(row.range_from),
    rangeTo: number(row.range_to),
    authorizationDate: text(row.authorization_date),
    sha256: text(row.sha256),
    logicalIdentity: text(row.logical_identity),
    secureRef: text(row.secure_ref),
    trustStatus: "verified_official",
    active: row.active === true,
  };
}

function mapDocument(
  row: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): ProductionDocument {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    dteType: number(row.dte_type) as ProductionDteType,
    businessOperationId: text(row.business_operation_id),
    status: text(row.status) as ProductionDocumentStatus,
    folio: row.folio === null ? null : number(row.folio),
    cafId: row.caf_id ? text(row.caf_id) : null,
    recipient: row.recipient as ProductionDocument["recipient"],
    lines: row.lines as ProductionDocument["lines"],
    references:
      (row.document_references as ProductionDocument["references"]) ?? [],
    netAmount: number(row.net_amount),
    exemptAmount: number(row.exempt_amount),
    taxAmount: number(row.tax_amount),
    totalAmount: number(row.total_amount),
    issueDate: text(row.issue_date),
    trackId: row.track_id_ciphertext
      ? revealProductionValue(text(row.track_id_ciphertext), env)
      : null,
    siiStatus: row.sii_status ? text(row.sii_status) : null,
    finalResponseSha256: row.final_response_sha256
      ? text(row.final_response_sha256)
      : null,
    createdBy: text(row.created_by),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapArtifact(row: Record<string, unknown>): ProductionArtifact {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    documentId: text(row.document_id),
    kind: text(row.kind) as ProductionArtifact["kind"],
    storageKey: text(row.storage_key),
    sha256: text(row.sha256),
    byteLength: number(row.byte_length),
    contentType: text(row.content_type),
    immutable: true,
    createdAt: text(row.created_at),
  };
}

export class SupabaseProductionDteRepository
  implements ProductionDteRepository
{
  constructor(
    private readonly client: SupabaseLike,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async getTenantSettings(
    tenantId: string,
  ): Promise<ProductionTenantSettings | null> {
    const result = await this.client
      .from("dte_production_tenant_settings")
      .select()
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (result.error) fail(result.error);
    if (!result.data) return null;
    const delivery = await this.client
      .from("dte_tenant_issuance_settings")
      .select("auto_email_delivery")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (delivery.error) fail(delivery.error);
    return {
      ...mapSettings(result.data, this.env),
      autoEmailDelivery: delivery.data?.auto_email_delivery === true,
    };
  }

  async importCaf(metadata: ProductionCafMetadata): Promise<void> {
    const result = await this.client.rpc("import_dte_production_caf_metadata", {
      p_id: metadata.id,
      p_tenant_id: metadata.tenantId,
      p_dte_type: metadata.dteType,
      p_issuer_rut: metadata.issuerRut,
      p_range_from: metadata.rangeFrom,
      p_range_to: metadata.rangeTo,
      p_authorization_date: metadata.authorizationDate,
      p_sha256: metadata.sha256,
      p_logical_identity: metadata.logicalIdentity,
      p_secure_ref: metadata.secureRef,
    });
    if (result.error) fail(result.error);
  }

  async selectCaf(
    tenantId: string,
    dteType: ProductionDteType,
    folio: number,
  ): Promise<ProductionCafMetadata | null> {
    const result = await this.client
      .from("dte_production_cafs")
      .select()
      .eq("tenant_id", tenantId)
      .eq("dte_type", dteType)
      .eq("active", true);
    if (result.error) fail(result.error);
    const matches = (result.data ?? [])
      .map(mapCaf)
      .filter((caf) => caf.rangeFrom <= folio && caf.rangeTo >= folio);
    if (matches.length > 1) throw new Error("DTE_CAF_COVERAGE_NOT_UNIQUE");
    return matches[0] ?? null;
  }

  async createDraft(
    input: ProductionDraftInput & {
      createdBy: string;
      issueDate: string;
      netAmount: number;
      exemptAmount: number;
      taxAmount: number;
      totalAmount: number;
    },
  ): Promise<ProductionDocument> {
    const result = await this.client
      .from("dte_production_documents")
      .insert({
        tenant_id: input.tenantId,
        dte_type: input.dteType,
        business_operation_id: input.businessOperationId,
        recipient: input.recipient,
        lines: input.lines,
        document_references: input.references ?? [],
        net_amount: input.netAmount,
        exempt_amount: input.exemptAmount,
        tax_amount: input.taxAmount,
        total_amount: input.totalAmount,
        issue_date: input.issueDate,
        created_by: input.createdBy,
      })
      .select()
      .single();
    if (result.error) {
      const existing = await this.client
        .from("dte_production_documents")
        .select()
        .eq("tenant_id", input.tenantId)
        .eq("business_operation_id", input.businessOperationId)
        .maybeSingle();
      if (existing.error || !existing.data) fail(result.error);
      return mapDocument(existing.data, this.env);
    }
    return mapDocument(result.data ?? {}, this.env);
  }

  async getDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionDocument | null> {
    const result = await this.client
      .from("dte_production_documents")
      .select()
      .eq("tenant_id", tenantId)
      .eq("id", documentId)
      .maybeSingle();
    if (result.error) fail(result.error);
    return result.data ? mapDocument(result.data, this.env) : null;
  }

  async reserveFolio(input: ReserveProductionFolioInput): Promise<{
    folio: number;
    cafId: string;
    reused: boolean;
  }> {
    const result = await this.client.rpc("reserve_dte_production_folio", {
      p_tenant_id: input.tenantId,
      p_dte_type: input.dteType,
      p_document_id: input.documentId,
      p_business_operation_id: input.businessOperationId,
    });
    if (result.error || result.data?.length !== 1) fail(result.error);
    const row = result.data[0];
    return {
      folio: number(row.folio),
      cafId: text(row.caf_id),
      reused: row.reused === true,
    };
  }

  async transitionDocument(input: {
    tenantId: string;
    documentId: string;
    from: ProductionDocumentStatus[];
    to: ProductionDocumentStatus;
    patch?: Partial<Pick<
      ProductionDocument,
      "folio" | "cafId" | "trackId" | "siiStatus" | "finalResponseSha256"
    >>;
  }): Promise<ProductionDocument> {
    if (input.to === "submitting") {
      if (input.patch && Object.keys(input.patch).length)
        throw new Error("DTE_SUBMISSION_PATCH_INVALID");
      const begun = await this.client.rpc("begin_dte_production_submission", {
        p_tenant_id: input.tenantId,
        p_document_id: input.documentId,
      });
      if (begun.error || begun.data?.length !== 1) fail(begun.error);
      return mapDocument(begun.data[0], this.env);
    }
    const track = input.patch?.trackId
      ? protectProductionValue(input.patch.trackId, this.env)
      : null;
    const result = await this.client
      .from("dte_production_documents")
      .update({
        status: input.to,
        ...(input.patch?.folio !== undefined ? { folio: input.patch.folio } : {}),
        ...(input.patch?.cafId !== undefined ? { caf_id: input.patch.cafId } : {}),
        ...(track
          ? {
              track_id_ciphertext: track.ciphertext,
              track_id_fingerprint: track.fingerprint,
            }
          : {}),
        ...(input.patch?.siiStatus !== undefined
          ? { sii_status: input.patch.siiStatus }
          : {}),
        ...(input.patch?.finalResponseSha256 !== undefined
          ? { final_response_sha256: input.patch.finalResponseSha256 }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", input.tenantId)
      .eq("id", input.documentId)
      .in("status", input.from)
      .select()
      .single();
    if (result.error || !result.data) fail(result.error);
    return mapDocument(result.data, this.env);
  }

  async storeArtifact(
    input: Omit<ProductionArtifact, "id" | "createdAt" | "immutable">,
  ): Promise<ProductionArtifact> {
    const result = await this.client
      .from("dte_production_artifacts")
      .insert({
        tenant_id: input.tenantId,
        document_id: input.documentId,
        kind: input.kind,
        storage_key: input.storageKey,
        sha256: input.sha256,
        byte_length: input.byteLength,
        content_type: input.contentType,
      })
      .select()
      .single();
    if (result.error || !result.data) fail(result.error);
    return mapArtifact(result.data);
  }

  async listArtifacts(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionArtifact[]> {
    const result = await this.client
      .from("dte_production_artifacts")
      .select()
      .eq("tenant_id", tenantId)
      .eq("document_id", documentId);
    if (result.error) fail(result.error);
    return (result.data ?? []).map(mapArtifact);
  }

  async createSubmissionAttempt(
    input: Omit<ProductionSubmissionAttempt, "id" | "createdAt">,
  ): Promise<ProductionSubmissionAttempt> {
    const result = await this.client
      .from("dte_production_submission_attempts")
      .insert({
        tenant_id: input.tenantId,
        document_id: input.documentId,
        attempt_number: 1,
        status: input.status,
        request_sha256: input.requestSha256,
      })
      .select()
      .single();
    if (result.error || !result.data) fail(result.error);
    return this.mapAttempt(result.data);
  }

  async updateSubmissionAttempt(
    tenantId: string,
    attemptId: string,
    patch: Partial<ProductionSubmissionAttempt>,
  ): Promise<ProductionSubmissionAttempt> {
    const track = patch.trackId
      ? protectProductionValue(patch.trackId, this.env)
      : null;
    const result = await this.client
      .from("dte_production_submission_attempts")
      .update({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.responseSha256 !== undefined
          ? { response_sha256: patch.responseSha256 }
          : {}),
        ...(patch.responseSafe !== undefined
          ? { response_safe: patch.responseSafe }
          : {}),
        ...(track
          ? {
              track_id_ciphertext: track.ciphertext,
              track_id_fingerprint: track.fingerprint,
            }
          : {}),
        ...(patch.beforeFetchAt !== undefined
          ? { before_fetch_at: patch.beforeFetchAt }
          : {}),
        ...(patch.afterFetchAt !== undefined
          ? { after_fetch_at: patch.afterFetchAt }
          : {}),
      })
      .eq("tenant_id", tenantId)
      .eq("id", attemptId)
      .select()
      .single();
    if (result.error || !result.data) fail(result.error);
    return this.mapAttempt(result.data);
  }

  async getSubmissionAttempt(
    tenantId: string,
    documentId: string,
  ): Promise<ProductionSubmissionAttempt | null> {
    const result = await this.client
      .from("dte_production_submission_attempts")
      .select()
      .eq("tenant_id", tenantId)
      .eq("document_id", documentId)
      .maybeSingle();
    if (result.error) fail(result.error);
    return result.data ? this.mapAttempt(result.data) : null;
  }

  async enqueueRecipientDelivery(
    input: Omit<RecipientOutboxRecord, "id" | "createdAt" | "deliveredAt" | "attempts" | "status">,
  ): Promise<RecipientOutboxRecord> {
    const result = await this.client
      .from("dte_production_recipient_outbox")
      .insert({
        tenant_id: input.tenantId,
        document_id: input.documentId,
        recipient_email: input.recipientEmail,
        idempotency_key: input.idempotencyKey,
        xml_artifact_id: input.xmlArtifactId,
        pdf_artifact_id: input.pdfArtifactId,
      })
      .select()
      .single();
    if (result.error || !result.data) fail(result.error);
    return this.mapOutbox(result.data);
  }

  async appendAudit(
    input: Omit<SafeProductionAudit, "id" | "createdAt">,
  ): Promise<SafeProductionAudit> {
    const result = await this.client
      .from("dte_production_audit")
      .insert({
        tenant_id: input.tenantId,
        document_id: input.documentId,
        action: input.action,
        actor_id: input.actorId === "system" ? null : input.actorId,
        metadata_safe: input.metadata,
      })
      .select()
      .single();
    if (result.error || !result.data) fail(result.error);
    return this.mapAudit(result.data);
  }

  async listAudit(
    tenantId: string,
    documentId: string,
  ): Promise<SafeProductionAudit[]> {
    const result = await this.client
      .from("dte_production_audit")
      .select()
      .eq("tenant_id", tenantId)
      .eq("document_id", documentId)
      .order("created_at", { ascending: true });
    if (result.error) fail(result.error);
    return (result.data ?? []).map((row) => this.mapAudit(row));
  }

  private mapAttempt(row: Record<string, unknown>): ProductionSubmissionAttempt {
    return {
      id: text(row.id),
      tenantId: text(row.tenant_id),
      documentId: text(row.document_id),
      attemptNumber: 1,
      status: text(row.status) as ProductionSubmissionAttempt["status"],
      requestSha256: text(row.request_sha256),
      responseSha256: row.response_sha256 ? text(row.response_sha256) : null,
      responseSafe:
        (row.response_safe as Record<string, unknown> | null) ?? null,
      trackId: row.track_id_ciphertext
        ? revealProductionValue(text(row.track_id_ciphertext), this.env)
        : null,
      beforeFetchAt: row.before_fetch_at ? text(row.before_fetch_at) : null,
      afterFetchAt: row.after_fetch_at ? text(row.after_fetch_at) : null,
      createdAt: text(row.created_at),
    };
  }

  private mapOutbox(row: Record<string, unknown>): RecipientOutboxRecord {
    return {
      id: text(row.id),
      tenantId: text(row.tenant_id),
      documentId: text(row.document_id),
      recipientEmail: text(row.recipient_email),
      idempotencyKey: text(row.idempotency_key),
      status: text(row.status) as RecipientOutboxRecord["status"],
      xmlArtifactId: text(row.xml_artifact_id),
      pdfArtifactId: text(row.pdf_artifact_id),
      attempts: number(row.attempts),
      createdAt: text(row.created_at),
      deliveredAt: row.delivered_at ? text(row.delivered_at) : null,
    };
  }

  private mapAudit(row: Record<string, unknown>): SafeProductionAudit {
    return {
      id: text(row.id),
      tenantId: text(row.tenant_id),
      documentId: row.document_id ? text(row.document_id) : null,
      action: text(row.action),
      actorId: row.actor_id ? text(row.actor_id) : "system",
      metadata:
        (row.metadata_safe as SafeProductionAudit["metadata"]) ?? {},
      createdAt: text(row.created_at),
    };
  }
}
