export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { runOneManualIssuanceWorker } from "@/lib/dte/automation/worker";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.error);
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  if (String(body?.confirmation ?? "") !== `PROCESAR ${id}`) {
    return errorResponse(400, "Debes confirmar explícitamente la continuación manual.");
  }

  const [intentResult, outboxResult] = await Promise.all([
    supabaseAdmin.from("dte_payment_document_intents")
      .select("id,status,resolved_dte_type,trigger_source,production_document_id")
      .eq("tenant_id", auth.tenantId).eq("id", id).maybeSingle(),
    supabaseAdmin.from("dte_issuance_outbox")
      .select("id,status,issuance_origin,network_attempts,locked_at")
      .eq("tenant_id", auth.tenantId).eq("intent_id", id).maybeSingle(),
  ]);
  const intent = intentResult.data;
  const outbox = outboxResult.data;
  if (intentResult.error || outboxResult.error || !intent || !outbox) {
    return errorResponse(404, "Emisión manual pendiente no encontrada.");
  }
  if (
    intent.status !== "PENDING" ||
    ![33, 39].includes(Number(intent.resolved_dte_type)) ||
    intent.trigger_source !== "manual_admin" ||
    intent.production_document_id !== null ||
    outbox.status !== "PENDING" ||
    !["legacy_unknown", "manual_admin"].includes(String(outbox.issuance_origin)) ||
    Number(outbox.network_attempts) !== 0 ||
    outbox.locked_at !== null
  ) {
    return errorResponse(409, "La emisión ya no es elegible para continuación manual.");
  }

  if (Number(intent.resolved_dte_type) === 39) {
    const snapshotResult = await supabaseAdmin.rpc(
      "capture_boleta39_commercial_customer_snapshot",
      {
        p_tenant_id: auth.tenantId,
        p_intent_id: intent.id,
        p_actor_id: auth.userId,
      },
    );
    if (snapshotResult.error || !snapshotResult.data) {
      return errorResponse(409, "No se pudo congelar el cliente asociado; no se reservó folio.");
    }
  }

  const originResult = await supabaseAdmin.from("dte_issuance_outbox")
    .update({ issuance_origin: "manual_admin" })
    .eq("tenant_id", auth.tenantId)
    .eq("id", outbox.id)
    .eq("status", "PENDING")
    .eq("network_attempts", 0)
    .is("locked_at", null)
    .select("id")
    .maybeSingle();
  if (originResult.error || !originResult.data) {
    return errorResponse(409, "La emisión manual cambió de estado; no se reservó folio.");
  }

  const result = await runOneManualIssuanceWorker({ targetOutboxId: outbox.id });
  const isBoleta = Number(intent.resolved_dte_type) === 39;
  return NextResponse.json({
    ok: result.processed === true,
    result,
    message: result.status === "SUBMITTED"
      ? `${isBoleta ? "Boleta" : "Factura"} recibida por el SII.`
      : result.status === "BLOCKED"
        ? "La emisión se detuvo antes del envío."
        : "Emisión manual procesada.",
  }, { status: result.processed === true ? 200 : 409 });
}
