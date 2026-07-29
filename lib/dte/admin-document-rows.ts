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
};

export async function loadAdminDocumentRows(tenantId: string) {
  const intentsResult = await supabaseAdmin
    .from("dte_payment_document_intents")
    .select("id,resolved_dte_type,amount_snapshot,status,safe_blocking_reason,production_document_id,receiver_snapshot,appointment_snapshot,created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (intentsResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  const intents = (intentsResult.data ?? []) as DocumentIntentRow[];
  const productionIds = intents
    .map((row) => row.production_document_id)
    .filter((id): id is string => Boolean(id));
  const productionResult = productionIds.length
    ? await supabaseAdmin
        .from("dte_production_documents")
        .select("id,folio")
        .eq("tenant_id", tenantId)
        .in("id", productionIds)
    : { data: [], error: null };
  if (productionResult.error) throw new Error("DTE_DOCUMENT_ROWS_UNAVAILABLE");
  const productionById = new Map(
    ((productionResult.data ?? []) as ProductionDocumentRow[])
      .map((document) => [document.id, document]),
  );

  return intents.map((row) => {
    const production = row.production_document_id
      ? productionById.get(row.production_document_id)
      : null;
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
      canView: Boolean(row.production_document_id),
      canDownload: Boolean(row.production_document_id) &&
        ["ACCEPTED", "DELIVERY_PENDING", "DELIVERED"].includes(row.status),
      canQuery: Boolean(row.production_document_id) &&
        ["SUBMITTED", "AMBIGUOUS"].includes(row.status),
      canCreateNote: Boolean(row.production_document_id) &&
        row.status === "ACCEPTED" &&
        [33, 39].includes(Number(row.resolved_dte_type)),
      canEmail: Boolean(row.production_document_id) &&
        ["ACCEPTED", "DELIVERY_PENDING", "DELIVERED"].includes(row.status),
    };
  });
}
