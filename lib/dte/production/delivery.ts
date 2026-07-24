import { createHash } from "node:crypto";

import type { PrivateDteArtifactStore } from "./artifact-store";
import type {
  ProductionArtifact,
  RecipientOutboxRecord,
} from "./types";

export interface RecipientDeliveryOutbox {
  claimNext(): Promise<RecipientOutboxRecord | null>;
  markDelivered(id: string): Promise<void>;
  markFailed(id: string): Promise<void>;
  getArtifact(id: string, tenantId: string): Promise<ProductionArtifact | null>;
}

export interface RecipientDeliveryTransport {
  send(input: {
    idempotencyKey: string;
    to: string;
    xml: Buffer;
    pdf: Buffer;
  }): Promise<void>;
}

export async function deliverOneRecipientOutbox(input: {
  outbox: RecipientDeliveryOutbox;
  artifacts: PrivateDteArtifactStore;
  transport: RecipientDeliveryTransport;
}): Promise<"empty" | "delivered" | "failed"> {
  const record = await input.outbox.claimNext();
  if (!record) return "empty";
  try {
    if (record.status !== "delivering")
      throw new Error("DTE_OUTBOX_NOT_CLAIMED");
    const [xmlMetadata, pdfMetadata] = await Promise.all([
      input.outbox.getArtifact(record.xmlArtifactId, record.tenantId),
      input.outbox.getArtifact(record.pdfArtifactId, record.tenantId),
    ]);
    if (
      !xmlMetadata ||
      !pdfMetadata ||
      xmlMetadata.documentId !== record.documentId ||
      pdfMetadata.documentId !== record.documentId ||
      xmlMetadata.kind !== "dte_xml" ||
      pdfMetadata.kind !== "pdf"
    )
      throw new Error("DTE_OUTBOX_ARTIFACT_MISMATCH");
    const [xml, pdf] = await Promise.all([
      input.artifacts.getPrivate(record.tenantId, xmlMetadata.storageKey),
      input.artifacts.getPrivate(record.tenantId, pdfMetadata.storageKey),
    ]);
    if (
      createHash("sha256").update(xml.bytes).digest("hex") !== xmlMetadata.sha256 ||
      createHash("sha256").update(pdf.bytes).digest("hex") !== pdfMetadata.sha256
    )
      throw new Error("DTE_OUTBOX_ARTIFACT_HASH_MISMATCH");
    await input.transport.send({
      idempotencyKey: record.idempotencyKey,
      to: record.recipientEmail,
      xml: xml.bytes,
      pdf: pdf.bytes,
    });
    await input.outbox.markDelivered(record.id);
    return "delivered";
  } catch {
    await input.outbox.markFailed(record.id);
    return "failed";
  }
}

type DbResult<T> = { data: T | null; error: { message?: string } | null };
type DbQuery = {
  select(): DbQuery;
  update(value: unknown): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  order(column: string, options?: { ascending: boolean }): DbQuery;
  limit(value: number): DbQuery;
  maybeSingle(): Promise<DbResult<Record<string, unknown>>>;
  single(): Promise<DbResult<Record<string, unknown>>>;
};
type DbClient = {
  from(table: string): DbQuery;
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<DbResult<Array<Record<string, unknown>>>>;
};

function mapOutbox(row: Record<string, unknown>): RecipientOutboxRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    documentId: String(row.document_id),
    recipientEmail: String(row.recipient_email),
    idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as RecipientOutboxRecord["status"],
    xmlArtifactId: String(row.xml_artifact_id),
    pdfArtifactId: String(row.pdf_artifact_id),
    attempts: Number(row.attempts),
    createdAt: String(row.created_at),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
  };
}

function mapArtifact(row: Record<string, unknown>): ProductionArtifact {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    documentId: String(row.document_id),
    kind: String(row.kind) as ProductionArtifact["kind"],
    storageKey: String(row.storage_key),
    sha256: String(row.sha256),
    byteLength: Number(row.byte_length),
    contentType: String(row.content_type),
    immutable: true,
    createdAt: String(row.created_at),
  };
}

export class SupabaseRecipientDeliveryOutbox
  implements RecipientDeliveryOutbox
{
  constructor(private readonly client: DbClient) {}

  async claimNext(): Promise<RecipientOutboxRecord | null> {
    const result = await this.client.rpc("claim_dte_recipient_outbox");
    if (result.error)
      throw new Error("DTE_OUTBOX_CLAIM_FAILED");
    const row = result.data?.[0];
    return row ? mapOutbox(row) : null;
  }

  async markDelivered(id: string): Promise<void> {
    const result = await this.client
      .from("dte_production_recipient_outbox")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "delivering")
      .select()
      .single();
    if (result.error) throw new Error("DTE_OUTBOX_COMPLETE_FAILED");
  }

  async markFailed(id: string): Promise<void> {
    const result = await this.client
      .from("dte_production_recipient_outbox")
      .update({ status: "failed" })
      .eq("id", id)
      .eq("status", "delivering")
      .select()
      .single();
    if (result.error) throw new Error("DTE_OUTBOX_FAIL_FAILED");
  }

  async getArtifact(
    id: string,
    tenantId: string,
  ): Promise<ProductionArtifact | null> {
    const result = await this.client
      .from("dte_production_artifacts")
      .select()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (result.error) throw new Error("DTE_OUTBOX_ARTIFACT_READ_FAILED");
    return result.data ? mapArtifact(result.data) : null;
  }
}
