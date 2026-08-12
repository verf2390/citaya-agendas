export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import {
  assertManualBoleta39IssuanceReady,
  Boleta39GateError,
} from "@/lib/dte/boleta39-manual-gate";
import { runOneManualIssuanceWorker } from "@/lib/dte/automation/worker";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function responseError(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return responseError(auth.status, auth.error);
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  if (String(body?.confirmation ?? "") !== `EMITIR ${id}`) {
    return responseError(400, "Debes confirmar explícitamente la emisión real.");
  }
  const expectedVersion = Number(body?.version);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return responseError(400, "La versión del borrador no es válida.");
  }
  const typeResult = await supabaseAdmin
    .from("dte_invoice_drafts")
    .select("dte_type,status,intent_id")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (typeResult.error || !typeResult.data) {
    return responseError(404, "Borrador no encontrado.");
  }

  const dteType = Number(typeResult.data.dte_type);

  if (dteType === 39) {
    try {
      await assertManualBoleta39IssuanceReady({
        tenantId: auth.tenantId,
        dteType: 39,
        issuanceOrigin: "manual_admin",
      });
    } catch (err) {
      if (err instanceof Boleta39GateError) {
        return responseError(409, `Emisión boleta 39 bloqueada: ${err.code}`, err.code);
      }
      return responseError(409, "Emisión boleta 39 no disponible.");
    }

    const snapshotResult = await supabaseAdmin.rpc(
      "freeze_boleta39_draft_customer_snapshot",
      {
        p_tenant_id: auth.tenantId,
        p_draft_id: id,
        p_expected_version: expectedVersion,
      },
    );
    if (snapshotResult.error || !snapshotResult.data) {
      return responseError(
        409,
        "No se pudo congelar el cliente asociado. Revisa el borrador antes de emitir.",
        "DTE_BOLETA39_CUSTOMER_SNAPSHOT_FAILED",
      );
    }
  }

  const result = await supabaseAdmin.rpc("finalize_dte_invoice_draft", {
    p_tenant_id: auth.tenantId,
    p_draft_id: id,
    p_expected_version: expectedVersion,
    p_actor_id: auth.userId,
    p_actor_role:
      auth.authMode === "platform_admin" ? "platform_admin" : "tenant_admin",
  });
  const finalized = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !finalized) {
    const message = String(result.error?.message ?? "");
    if (message.includes("DTE_MANUAL_REASON_REQUIRED")) {
      return responseError(
        400,
        "El motivo de emisión manual es obligatorio (mínimo 10 caracteres).",
        "DTE_MANUAL_REASON_REQUIRED",
      );
    }
    if (message.includes("DTE_PAYMENT_AMOUNT_MISMATCH")) {
      return responseError(
        409,
        "El pago confirmado no coincide exactamente con el total IVA incluido.",
        "DTE_PAYMENT_AMOUNT_MISMATCH",
      );
    }
    if (
      message.includes("DTE_TAX_DATA_INCOMPLETE") ||
      message.includes("DTE_TAX_SNAPSHOT_INVALID")
    ) {
      return responseError(
        409,
        "Completa los datos tributarios vigentes y vuelve a revisar el borrador.",
        "DTE_TAX_DATA_INCOMPLETE",
      );
    }
    if (message.includes("DTE_INVOICE_DRAFT_VERSION_CONFLICT")) {
      return responseError(
        409,
        "El borrador cambió; vuelve a abrirlo antes de emitir.",
        "DTE_INVOICE_DRAFT_VERSION_CONFLICT",
      );
    }
    if (message.includes("TENANT_MODE_DTE_BLOCKED") || message.includes("BOLETA39_MANUAL_ENQUEUE_BLOCKED")) {
      return responseError(
        409,
        "Emisión manual no habilitada para encolado.",
        "BOLETA39_MANUAL_ENQUEUE_BLOCKED",
      );
    }
    if (message.includes("DTE_INVOICE_DRAFT_LINES_REQUIRED")) {
      return responseError(
        409,
        "El borrador requiere al menos una línea de detalle.",
        "DTE_INVOICE_DRAFT_LINES_REQUIRED",
      );
    }
    return responseError(
      409,
      `Error al procesar el borrador (${message || "Verifique los datos del borrador"}). No reemitir mientras se revisa.`,
      "DTE_FINALIZE_ERROR",
    );
  }

  let workerResult: Awaited<ReturnType<typeof runOneManualIssuanceWorker>> | null = null;

  // The click is the manual dispatch authority for both sales document types.
  // Process only the exact outbox created by this confirmed draft; automatic
  // issuance remains disabled.
  if ([33, 39].includes(dteType) && finalized.intent_id) {
    if (dteType === 39) {
      const customerSnapshotResult = await supabaseAdmin.rpc(
        "capture_boleta39_commercial_customer_snapshot",
        {
          p_tenant_id: auth.tenantId,
          p_intent_id: finalized.intent_id,
          p_actor_id: auth.userId,
        },
      );
      if (customerSnapshotResult.error || !customerSnapshotResult.data) {
        return responseError(500, "No se pudo congelar el cliente de la emisión confirmada.", "DTE_BOLETA39_CUSTOMER_SNAPSHOT_FAILED");
      }
    }
    const outboxResult = await supabaseAdmin
      .from("dte_issuance_outbox")
      .update({ issuance_origin: "manual_admin" })
      .eq("tenant_id", auth.tenantId)
      .eq("intent_id", finalized.intent_id)
      .select("id,status")
      .maybeSingle();
    if (outboxResult.error || !outboxResult.data) {
      return responseError(500, "La emisión quedó confirmada, pero no se pudo localizar su cola manual.", "DTE_MANUAL_OUTBOX_NOT_FOUND");
    }
    if (outboxResult.data.status === "PENDING") {
      workerResult = await runOneManualIssuanceWorker({
        targetOutboxId: outboxResult.data.id,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    intentId: finalized.intent_id,
    status: finalized.intent_status,
    duplicate: finalized.duplicate === true,
    issuanceOrigin: "manual_admin",
    worker: workerResult,
  });
}
