import { friendlyDteReason, friendlyDteStatus } from "@/lib/dte/cutover";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DocumentIntentRow = {
  id: string;
  resolved_dte_type: number | null;
  amount_snapshot: number;
  status: string;
  safe_blocking_reason: string | null;
  production_document_id: string | null;
  trigger_source: string;
  origin: string;
  receiver_snapshot: { legalName?: string } | null;
  appointment_snapshot: { customerName?: string } | null;
  created_at: string;
};

type ProductionDocumentRow = {
  id: string;
  folio: number | null;
  sii_status: string | null;
  track_id_fingerprint: string | null;
};

type ProductionArtifactRow = {
  id: string;
  document_id: string;
  kind: string;
  sha256: string;
};

type ProductionArtifactHeadRow = {
  document_id: string;
  artifact_id: string;
};

type ProductionSubmissionAttemptRow = {
  document_id: string;
  status: string;
  request_sha256: string;
  track_id_fingerprint: string | null;
};

type InvoiceDraftRow = {
  id: string;
  customer_id: string | null;
  source_intent_id: string | null;
  dte_type: number | null;
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
  currentUploadTrackVerified: boolean;
}) {
  const hasDteXml = input.artifactKinds.includes("dte_xml");
  const hasPdf = input.artifactKinds.includes("pdf");
  const deliverable = ["ACCEPTED", "DELIVERY_PENDING", "DELIVERED"]
    .includes(input.status);
  return {
    canViewTrackId: Boolean(
      input.productionDocumentId &&
      input.trackIdFingerprint &&
      input.currentUploadTrackVerified
    ),
    canDownloadXml: Boolean(input.productionDocumentId && hasDteXml),
    canDownloadPdf: Boolean(input.productionDocumentId && hasPdf),
    canEmail: Boolean(input.productionDocumentId && deliverable && hasDteXml && hasPdf),
  };
}

export async function loadAdminDocumentRows(tenantId: string) {
  const [intentsResult, draftsResult] = await Promise.all([
    supabaseAdmin
      .from("dte_payment_document_intents")
      .select("id,resolved_dte_type,amount_snapshot,status,safe_blocking_reason,production_document_id,trigger_source,origin,receiver_snapshot,appointment_snapshot,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("dte_invoice_drafts")
      .select("id,customer_id,source_intent_id,dte_type,status,total_amount,review_reason,recipient_preview,created_at")
      .eq("tenant_id", tenantId)
      .in("status", ["DRAFT", "REVIEW_REQUIRED", "VALIDATED"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (intentsResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  if (draftsResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  const intents = (intentsResult.data ?? []) as DocumentIntentRow[];
  const rawDrafts = (draftsResult.data ?? []) as InvoiceDraftRow[];

  const customerIds = Array.from(new Set(rawDrafts.map((d) => d.customer_id).filter((id): id is string => Boolean(id))));
  const customerMap = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customerData } = await supabaseAdmin
      .from("customers")
      .select("id,full_name")
      .in("id", customerIds);
    for (const c of customerData ?? []) {
      if (c.id && c.full_name) customerMap.set(c.id, c.full_name);
    }
  }

  const productionIds = intents
    .map((row) => row.production_document_id)
    .filter((id): id is string => Boolean(id));
  const productionResult = productionIds.length
    ? await supabaseAdmin
        .from("dte_production_documents")
        .select("id,folio,sii_status,track_id_fingerprint")
        .eq("tenant_id", tenantId)
        .in("id", productionIds)
    : { data: [], error: null };
  if (productionResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  const productionById = new Map(
    ((productionResult.data ?? []) as ProductionDocumentRow[])
      .map((document) => [document.id, document]),
  );
  const [artifactsResult, headsResult, attemptsResult] = productionIds.length
    ? await Promise.all([
        supabaseAdmin.from("dte_production_artifacts")
          .select("id,document_id,kind,sha256")
          .eq("tenant_id", tenantId).in("document_id", productionIds),
        supabaseAdmin.from("dte_production_artifact_heads")
          .select("document_id,artifact_id")
          .eq("tenant_id", tenantId).eq("kind", "envio_xml")
          .in("document_id", productionIds),
        supabaseAdmin.from("dte_production_submission_attempts")
          .select("document_id,status,request_sha256,track_id_fingerprint")
          .eq("tenant_id", tenantId).in("document_id", productionIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (artifactsResult.error || headsResult.error || attemptsResult.error) {
    throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  }
  const artifactKindsByDocument = new Map<string, string[]>();
  for (const artifact of (artifactsResult.data ?? []) as ProductionArtifactRow[]) {
    const kinds = artifactKindsByDocument.get(artifact.document_id) ?? [];
    kinds.push(artifact.kind);
    artifactKindsByDocument.set(artifact.document_id, kinds);
  }
  const artifacts = (artifactsResult.data ?? []) as ProductionArtifactRow[];
  const currentEnvioShaByDocument = new Map(
    ((headsResult.data ?? []) as ProductionArtifactHeadRow[]).map((head) => [
      head.document_id,
      artifacts.find((artifact) => artifact.id === head.artifact_id)?.sha256 ?? null,
    ]),
  );
  const attemptByDocument = new Map(
    ((attemptsResult.data ?? []) as ProductionSubmissionAttemptRow[])
      .map((attempt) => [attempt.document_id, attempt]),
  );

  const mirroredIntentIds = new Set(
    rawDrafts
      .map((draft) => draft.source_intent_id)
      .filter((id): id is string => Boolean(id)),
  );
  const intentRows = intents.filter((row) => !mirroredIntentIds.has(row.id)).map((row) => {
    const production = row.production_document_id
      ? productionById.get(row.production_document_id)
      : null;
    const currentAttempt = row.production_document_id
      ? attemptByDocument.get(row.production_document_id)
      : null;
    const currentEnvioSha = row.production_document_id
      ? currentEnvioShaByDocument.get(row.production_document_id)
      : null;
    const currentUploadTrackVerified = Boolean(
      production?.track_id_fingerprint &&
      currentAttempt?.status === "submitted" &&
      currentAttempt.request_sha256 === currentEnvioSha &&
      currentAttempt.track_id_fingerprint === production.track_id_fingerprint,
    );
    const actions = adminDocumentActionAvailability({
      productionDocumentId: row.production_document_id,
      trackIdFingerprint: production?.track_id_fingerprint ?? null,
      artifactKinds: row.production_document_id
        ? artifactKindsByDocument.get(row.production_document_id) ?? []
        : [],
      status: row.status,
      currentUploadTrackVerified,
    });
    const isAutomaticProcessing = !row.production_document_id &&
      row.status === "PENDING" &&
      row.origin === "automatic_payment" &&
      ["khipu", "webpay", "mercadopago", "manual_verified"]
        .includes(row.trigger_source) &&
      [33, 39].includes(Number(row.resolved_dte_type));
    return {
      id: row.id,
      productionDocumentId: row.production_document_id,
      type: row.resolved_dte_type,
      folio: production?.folio ?? null,
      customer: row.receiver_snapshot?.legalName ??
        row.appointment_snapshot?.customerName ?? "Consumidor final",
      amount: row.amount_snapshot,
      status:
        row.status === "SUBMITTED" && production && !currentUploadTrackVerified
          ? "Estado requiere conciliación"
          : friendlyDteStatus(
              row.status,
              row.safe_blocking_reason,
              production?.sii_status,
            ),
      rawStatus: row.status,
      siiStatus: production?.sii_status ?? null,
      date: row.created_at,
      blockingReason: friendlyDteReason(row.safe_blocking_reason),
      terminal: [
        "BLOCKED", "SUBMITTED", "ACCEPTED", "ACCEPTED_WITH_OBJECTIONS",
        "REJECTED", "AMBIGUOUS", "CANCELED", "DELIVERY_PENDING", "DELIVERED",
      ].includes(row.status),
      canView: actions.canViewTrackId,
      canDownloadXml: actions.canDownloadXml,
      canDownloadPdf: actions.canDownloadPdf,
      canQuery: currentUploadTrackVerified &&
        ["SUBMITTED", "AMBIGUOUS"].includes(row.status),
      canCreateNote: Boolean(row.production_document_id) &&
        row.status === "ACCEPTED" &&
        [33, 39].includes(Number(row.resolved_dte_type)),
      canEmail: actions.canEmail,
      canProcessManual: !row.production_document_id &&
        row.status === "PENDING" &&
        row.trigger_source === "manual_admin" &&
        [33, 39].includes(Number(row.resolved_dte_type)),
      isAutomaticProcessing,
      canProcessAutomatic: false,
    };
  });
  const draftRows = rawDrafts.map((row) => ({
    id: row.id,
    productionDocumentId: null,
    type: Number(row.dte_type) || 33,
    folio: null,
    customer: row.recipient_preview?.legalName || (row.customer_id ? customerMap.get(row.customer_id) : null) || "Consumidor final",
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
    canProcessManual: false,
    isAutomaticProcessing: false,
    canProcessAutomatic: false,
  }));
  return [...draftRows, ...intentRows]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 20);
}
