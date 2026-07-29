export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function responseError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
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
    .select("dte_type")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (typeResult.error || !typeResult.data) {
    return responseError(404, "Borrador no encontrado.");
  }
  if (Number(typeResult.data.dte_type) === 39) {
    return responseError(
      409,
      "La boleta está preparada en modo PRE-CAF, pero su emisión aún no está autorizada.",
    );
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
    const code = String(result.error?.message ?? "");
    if (code.includes("DTE_PAYMENT_AMOUNT_MISMATCH")) {
      return responseError(
        409,
        "El pago confirmado no coincide exactamente con el total IVA incluido.",
      );
    }
    if (
      code.includes("DTE_TAX_DATA_INCOMPLETE") ||
      code.includes("DTE_TAX_SNAPSHOT_INVALID")
    ) {
      return responseError(
        409,
        "Completa los datos tributarios vigentes y vuelve a revisar el borrador.",
      );
    }
    if (code.includes("DTE_INVOICE_DRAFT_VERSION_CONFLICT")) {
      return responseError(
        409,
        "El borrador cambió; vuelve a abrirlo antes de emitir.",
      );
    }
    return responseError(
      409,
      "No se pudo encolar la factura; vuelve a revisar el borrador.",
    );
  }
  return NextResponse.json({
    ok: true,
    intentId: finalized.intent_id,
    status: finalized.intent_status,
    duplicate: finalized.duplicate === true,
  });
}
