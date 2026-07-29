export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  requireProductionAdmin,
  safeProductionApiError,
} from "@/lib/dte/production/api";
import { planSiiStatusReconciliation } from "@/lib/dte/cutover";
import { createServerProductionDteService } from "@/lib/dte/production/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const body = (await req.json()) as {
      tenantId?: string;
      tenantSlug?: string;
    };
    const auth = await requireProductionAdmin(
      req,
      body.tenantId,
      body.tenantSlug,
    );
    if (!auth.ok)
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    const { id } = await context.params;
    const status = await createServerProductionDteService().queryStatusManually(
      {
        tenantId: auth.tenantId,
        documentId: id,
        actorId: auth.userId,
      },
    );
    const normalized = String(status.siiStatus ?? "").toLowerCase();
    const currentIntentResult = await supabaseAdmin
      .from("dte_payment_document_intents")
      .select("status")
      .eq("tenant_id", auth.tenantId)
      .eq("production_document_id", id)
      .maybeSingle();
    if (currentIntentResult.error || !currentIntentResult.data) {
      throw new Error("DTE_INTENT_STATUS_RECONCILIATION_FAILED");
    }
    const reconciliation = planSiiStatusReconciliation(
      currentIntentResult.data.status,
      normalized,
    );
    if (reconciliation.shouldReconcile) {
      const intentResult = await supabaseAdmin.rpc("dte_reconcile_intent_status", {
        p_tenant_id: auth.tenantId,
        p_production_document_id: id,
        p_status: reconciliation.targetStatus,
        p_sii_status: normalized.slice(0, 32),
        p_actor_id: auth.userId,
      });
      if (intentResult.error) {
        throw new Error("DTE_INTENT_STATUS_RECONCILIATION_FAILED");
      }
    }
    return NextResponse.json({
      ok: true,
      status: {
        siiStatus: status.siiStatus,
        responseSha256: status.responseSha256,
      },
    });
  } catch (error) {
    return safeProductionApiError(error);
  }
}
