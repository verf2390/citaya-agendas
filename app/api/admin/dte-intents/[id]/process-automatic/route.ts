export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { runOneAutomaticIssuanceWorker } from "@/lib/dte/automation/worker";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const AUTOMATIC_TRIGGER_SOURCES = new Set([
  "khipu",
  "webpay",
  "mercadopago",
  "manual_verified",
]);

function errorResponse(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function resultMessage(status: string | null) {
  if (status === "SUBMITTED") return "Documento enviado al SII.";
  if (status === "BLOCKED") return "La emisión se detuvo antes del envío.";
  if (status === "AMBIGUOUS" || status === "FENCED") {
    return "La emisión requiere conciliación; no la reintentes.";
  }
  if (status === "DISABLED") return "La automatización no está habilitada.";
  if (status === "REJECTED") return "El SII rechazó el documento.";
  return "La emisión cambió de estado; no se procesó otra emisión.";
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.error);

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  if (String(body?.confirmation ?? "") !== `EJECUTAR ${id}`) {
    return errorResponse(400, "Debes confirmar explícitamente la emisión automática.");
  }
  if (
    process.env.DTE_PRODUCTION_ENABLED !== "true" ||
    process.env.DTE_AUTOMATIC_WORKER_ENABLED !== "true"
  ) {
    return errorResponse(409, "La automatización no está habilitada.");
  }

  const [intentResult, outboxResult] = await Promise.all([
    supabaseAdmin.from("dte_payment_document_intents")
      .select("id,status,resolved_dte_type,trigger_source,origin,production_document_id,network_attempt_count")
      .eq("tenant_id", auth.tenantId)
      .eq("id", id)
      .maybeSingle(),
    supabaseAdmin.from("dte_issuance_outbox")
      .select("id,status,issuance_origin,network_attempts,locked_at")
      .eq("tenant_id", auth.tenantId)
      .eq("intent_id", id)
      .maybeSingle(),
  ]);
  const intent = intentResult.data;
  const outbox = outboxResult.data;
  if (intentResult.error || outboxResult.error || !intent || !outbox) {
    return errorResponse(404, "Emisión automática pendiente no encontrada.");
  }
  if (
    intent.status !== "PENDING" ||
    ![33, 39].includes(Number(intent.resolved_dte_type)) ||
    !AUTOMATIC_TRIGGER_SOURCES.has(String(intent.trigger_source)) ||
    intent.origin !== "automatic_payment" ||
    intent.production_document_id !== null ||
    Number(intent.network_attempt_count) !== 0 ||
    outbox.status !== "PENDING" ||
    outbox.issuance_origin !== "automatic_system" ||
    Number(outbox.network_attempts) !== 0 ||
    outbox.locked_at !== null
  ) {
    return errorResponse(409, "La emisión ya no es elegible para ejecución automática.");
  }

  if (Number(intent.resolved_dte_type) === 39) {
    const snapshotResult = await supabaseAdmin
      .from("dte_boleta39_commercial_customer_snapshots")
      .select("intent_id")
      .eq("tenant_id", auth.tenantId)
      .eq("intent_id", intent.id)
      .maybeSingle();
    if (snapshotResult.error || !snapshotResult.data) {
      return errorResponse(409, "Falta el cliente comercial congelado; no se inició la emisión.");
    }
  }

  try {
    const result = await runOneAutomaticIssuanceWorker({
      automaticTargetOutboxId: outbox.id,
    });
    const message = resultMessage(result.status);
    const ok = result.processed === true &&
      !["AMBIGUOUS", "FENCED"].includes(String(result.status));
    return NextResponse.json(
      { ok, status: result.status, message },
      { status: ok ? 200 : 409 },
    );
  } catch {
    return errorResponse(
      409,
      "La emisión cambió de estado o requiere conciliación; no se procesó otra emisión.",
    );
  }
}
