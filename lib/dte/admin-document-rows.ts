import { friendlyDteStatus } from "@/lib/dte/cutover";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DocumentIntentRow = {
  id: string;
  resolved_dte_type: number | null;
  amount_snapshot: number;
  status: string;
  safe_blocking_reason: string | null;
  production_document_id: string | null;
  receiver_snapshot: { legalName?: string } | null;
  appointment_snapshot: { customerName?: string } | null;
  created_at: string;
};

type ProductionDocumentRow = {
  id: string;
  folio: number | null;
  track_id_fingerprint: string | null;
};

type ProductionArtifactRow = {
  document_id: string;
  kind: string;
};

type InvoiceDraftRow = {
  id: string;
  source_intent_id: string | null;
  status: string;
  total_amount: number;
  review_reason: string | null;
  recipient_preview: { legalName?: string } | null;
  created_at: string;
};

export function adminDocumentActionAvailability(input: {
  productionDocumentId: string | null;
  trackIdFingerprint: string | null;
  artifactKinds: readonly string[];
  status: string;
}) {
  const hasDteXml = input.artifactKinds.includes("dte_xml");
  const hasPdf = input.artifactKinds.includes("pdf");
  const deliverable = ["ACCEPTED", "DELIVERY_PENDING", "DELIVERED"]
    .includes(input.status);
  return {
    canViewTrackId: Boolean(input.productionDocumentId && input.trackIdFingerprint),
    canDownloadXml: Boolean(input.productionDocumentId && hasDteXml),
    canDownloadPdf: Boolean(input.productionDocumentId && hasPdf),
    canEmail: Boolean(input.productionDocumentId && deliverable && hasDteXml && hasPdf),
  };
}

export async function loadAdminDocumentRows(tenantId: string) {
  const [intentsResult, draftsResult] = await Promise.all([
    supabaseAdmin
      .from("dte_payment_document_intents")
      .select("id,resolved_dte_type,amount_snapshot,status,safe_blocking_reason,production_document_id,receiver_snapshot,appointment_snapshot,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("dte_invoice_drafts")
      .select("id,source_intent_id,status,total_amount,review_reason,recipient_preview,created_at")
      .eq("tenant_id", tenantId)
      .in("status", ["DRAFT", "REVIEW_REQUIRED", "VALIDATED"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (intentsResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  if (draftsResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  const intents = (intentsResult.data ?? []) as DocumentIntentRow[];
  const productionIds = intents
    .map((row) => row.production_document_id)
    .filter((id): id is string => Boolean(id));
  const productionResult = productionIds.length
    ? await supabaseAdmin
        .from("dte_production_documents")
        .select("id,folio,track_id_fingerprint")
        .eq("tenant_id", tenantId)
        .in("id", productionIds)
    : { data: [], error: null };
  if (productionResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  const productionById = new Map(
    ((productionResult.data ?? []) as ProductionDocumentRow[])
      .map((document) => [document.id, document]),
  );
  const artifactsResult = productionIds.length
    ? await supabaseAdmin
        .from("dte_production_artifacts")
        .select("document_id,kind")
        .eq("tenant_id", tenantId)
        .in("document_id", productionIds)
    : { data: [], error: null };
  if (artifactsResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  const artifactKindsByDocument = new Map<string, string[]>();
  for (const artifact of (artifactsResult.data ?? []) as ProductionArtifactRow[]) {
    const kinds = artifactKindsByDocument.get(artifact.document_id) ?? [];
    kinds.push(artifact.kind);
    artifactKindsByDocument.set(artifact.document_id, kinds);
  }

  const mirroredIntentIds = new Set(
    ((draftsResult.data ?? []) as InvoiceDraftRow[])
      .map((draft) => draft.source_intent_id)
      .filter((id): id is string => Boolean(id)),
  );
  const intentRows = intents.filter((row) => !mirroredIntentIds.has(row.id)).map((row) => {
    const production = row.production_document_id
      ? productionById.get(row.production_document_id)
      : null;
    const actions = adminDocumentActionAvailability({
      productionDocumentId: row.production_document_id,
      trackIdFingerprint: production?.track_id_fingerprint ?? null,
      artifactKinds: row.production_document_id
        ? artifactKindsByDocument.get(row.production_document_id) ?? []
        : [],
      status: row.status,
    });
    return {
      id: row.id,
      productionDocumentId: row.production_document_id,
      type: row.resolved_dte_type,
      folio: production?.folio ?? null,
      customer: row.receiver_snapshot?.legalName ??
        row.appointment_snapshot?.customerName ?? "Consumidor final",
      amount: row.amount_snapshot,
      status: friendlyDteStatus(row.status, row.safe_blocking_reason),
      rawStatus: row.status,
      date: row.created_at,
      blockingReason: row.safe_blocking_reason,
      terminal: [
        "BLOCKED", "SUBMITTED", "ACCEPTED", "ACCEPTED_WITH_OBJECTIONS",
        "REJECTED", "AMBIGUOUS", "CANCELED", "DELIVERY_PENDING", "DELIVERED",
      ].includes(row.status),
      canView: actions.canViewTrackId,
      canDownloadXml: actions.canDownloadXml,
      canDownloadPdf: actions.canDownloadPdf,
      canQuery: Boolean(row.production_document_id) &&
        ["SUBMITTED", "AMBIGUOUS"].includes(row.status),
      canCreateNote: Boolean(row.production_document_id) &&
        row.status === "ACCEPTED" &&
        [33, 39].includes(Number(row.resolved_dte_type)),
      canEmail: actions.canEmail,
    };
  });
  const draftRows = ((draftsResult.data ?? []) as InvoiceDraftRow[]).map((row) => ({
    id: row.id,
    productionDocumentId: null,
    type: 33,
    folio: null,
    customer: row.recipient_preview?.legalName ?? "Receptor pendiente",
    amount: Number(row.total_amount),
    status: friendlyDteStatus(row.status, row.review_reason),
    rawStatus: row.status,
    date: row.created_at,
    blockingReason: row.review_reason,
    terminal: row.status === "CANCELED",
    canView: false,
    canDownloadXml: false,
    canDownloadPdf: false,
    canQuery: false,
    canCreateNote: false,
    canEmail: false,
  }));
  return [...draftRows, ...intentRows]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 20);
}
