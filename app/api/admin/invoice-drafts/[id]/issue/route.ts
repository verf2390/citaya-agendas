export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import {
  assertManualBoleta39IssuanceReady,
  Boleta39GateError,
} from "@/lib/dte/boleta39-manual-gate";
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
    if (message.includes("DTE_PAYMENT_AMOUNT_MISMATCH")) {
      return responseError(
        409,
        "El pago confirmado no coincide exactamente con el total IVA incluido.",
      );
    }
    if (
      message.includes("DTE_TAX_DATA_INCOMPLETE") ||
      message.includes("DTE_TAX_SNAPSHOT_INVALID")
    ) {
      return responseError(
        409,
        "Completa los datos tributarios vigentes y vuelve a revisar el borrador.",
      );
    }
    if (message.includes("DTE_INVOICE_DRAFT_VERSION_CONFLICT")) {
      return responseError(
        409,
        "El borrador cambió; vuelve a abrirlo antes de emitir.",
      );
    }
    return responseError(
      409,
      "No se pudo encolar el documento; vuelve a revisar el borrador.",
    );
  }

  // Stamp issuance_origin in outbox item for Type 39
  if (dteType === 39 && finalized.intent_id) {
    await supabaseAdmin
      .from("dte_issuance_outbox")
      .update({ issuance_origin: "manual_admin" })
      .eq("tenant_id", auth.tenantId)
      .eq("intent_id", finalized.intent_id);
  }

  return NextResponse.json({
    ok: true,
    intentId: finalized.intent_id,
    status: finalized.intent_status,
    duplicate: finalized.duplicate === true,
    issuanceOrigin: "manual_admin",
  });
}
