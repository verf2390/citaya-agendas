export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { checkManualBoleta39IssuanceReadiness } from "@/lib/dte/boleta39-manual-gate";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.error);
  const { id } = await context.params;

  const draftResult = await supabaseAdmin
    .from("dte_invoice_drafts")
    .select("id,customer_id,dte_type,status,version,net_amount,tax_amount,total_amount,issuer_preview,recipient_preview")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (draftResult.error || !draftResult.data) {
    return errorResponse(404, "Borrador no encontrado.");
  }

  const draft = draftResult.data;
  const dteType = Number(draft.dte_type) === 39 ? 39 : 33;

  const gateResult = dteType === 39
    ? await checkManualBoleta39IssuanceReadiness({
        tenantId: auth.tenantId,
        dteType: 39,
        issuanceOrigin: "manual_admin",
      })
    : { ready: true, blockingCodes: [], details: { availableFoliosCount: 1, productionCertificateReady: true, siiAuthorizationStatus: "approved" } };

  const [customerResult, linesResult] = await Promise.all([
    supabaseAdmin
      .from("customers")
      .select("full_name,rut_normalized")
      .eq("tenant_id", auth.tenantId)
      .eq("id", draft.customer_id)
      .maybeSingle(),
    supabaseAdmin
      .from("dte_invoice_draft_lines")
      .select("id,description,quantity,unit_net_amount,total_amount")
      .eq("tenant_id", auth.tenantId)
      .eq("draft_id", id),
  ]);

  const customer = customerResult.data;
  const lines = linesResult.data ?? [];
  const issuer = (draft.issuer_preview as Record<string, string>) ?? {};

  return NextResponse.json({
    ok: true,
    preview: {
      readiness: gateResult.ready,
      blockingCodes: gateResult.blockingCodes,
      dteType,
      issuer: {
        legalName: issuer.legalName || "Emisor no configurado",
        rut: issuer.rut || "RUT pendiente",
      },
      recipientSummary: {
        name: customer?.full_name || "Consumidor final",
        rut: customer?.rut_normalized || null,
      },
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        totalAmount: l.total_amount,
      })),
      lineCount: lines.length,
      netAmount: Number(draft.net_amount),
      taxAmount: Number(draft.tax_amount),
      totalAmount: Number(draft.total_amount),
      estimatedFolioLabel: "Folio estimado: sujeto a asignación atómica al confirmar.",
      certificateReady: Boolean(gateResult.details.productionCertificateReady),
      siiAuthorizationStatus: String(gateResult.details.siiAuthorizationStatus),
      version: Number(draft.version),
    },
  });
}
