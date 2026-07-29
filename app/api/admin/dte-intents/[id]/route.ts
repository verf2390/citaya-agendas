export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TERMINAL_STATUSES = new Set([
  "BLOCKED",
  "SUBMITTED",
  "ACCEPTED",
  "ACCEPTED_WITH_OBJECTIONS",
  "REJECTED",
  "AMBIGUOUS",
  "CANCELED",
  "DELIVERY_PENDING",
  "DELIVERED",
]);

function uiState(status: string) {
  if (status === "PENDING") return "pending";
  if (["PREPARING", "READY", "SUBMITTING"].includes(status)) return "processing";
  if (status === "SUBMITTED") return "sent";
  if (["ACCEPTED", "ACCEPTED_WITH_OBJECTIONS", "DELIVERY_PENDING", "DELIVERED"].includes(status)) {
    return "accepted";
  }
  return "failed";
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status === 403 ? 404 : auth.status },
    );
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  }
  const [{ data: intent, error }, { data: outbox }, { data: failureEvent }] = await Promise.all([
    supabaseAdmin
      .from("dte_payment_document_intents")
      .select("id,status,safe_blocking_reason,production_document_id,amount_snapshot,updated_at")
      .eq("tenant_id", auth.tenantId)
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("dte_issuance_outbox")
      .select("id,status,last_safe_error,locked_at,lease_expires_at,updated_at")
      .eq("tenant_id", auth.tenantId)
      .eq("intent_id", id)
      .maybeSingle(),
    supabaseAdmin
      .from("dte_document_events")
      .select("safe_metadata,created_at")
      .eq("tenant_id", auth.tenantId)
      .eq("intent_id", id)
      .eq("event_type", "ISSUANCE_BLOCKED")
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle(),
  ]);
  if (error || !intent) {
    return NextResponse.json({ ok: false, error: "Recurso no encontrado" }, { status: 404 });
  }
  const status = String(intent.status);
  return NextResponse.json({
    ok: true,
    intent: {
      ...intent,
      outbox: outbox ?? null,
      uiState: uiState(status),
      terminal: TERMINAL_STATUSES.has(status),
      error: intent.safe_blocking_reason ?? outbox?.last_safe_error ?? null,
      failure: failureEvent?.safe_metadata ?? null,
    },
  });
}
