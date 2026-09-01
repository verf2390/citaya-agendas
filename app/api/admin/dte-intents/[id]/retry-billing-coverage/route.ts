export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
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
  if (!isUuid(id)) return errorResponse(404, "Recurso no encontrado.");

  const body = await req.json().catch(() => null);
  if (String(body?.confirmation ?? "") !== `RECONCILIAR COBERTURA ${id}`) {
    return errorResponse(
      400,
      "Debes confirmar explícitamente la reconciliación local.",
    );
  }

  const { data, error } = await supabaseAdmin.rpc(
    "billing_retry_accepted_dte_coverage",
    {
      p_tenant_id: auth.tenantId,
      p_intent_id: id,
    },
  );

  if (error) {
    return errorResponse(
      409,
      "El intent no es elegible o sus relaciones de billing son inconsistentes.",
    );
  }

  const reconciledCoverageRows = Number(data ?? 0);
  return NextResponse.json({
    ok: true,
    intentId: id,
    reconciledCoverageRows,
    idempotent: reconciledCoverageRows === 0,
  });
}
