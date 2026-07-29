export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import {
  calculateInvoiceTotals,
  validateInvoiceDraftLines,
} from "@/lib/dte/invoice-drafts";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function responseError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return responseError(auth.status, auth.error);
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const expectedVersion = Number(body?.version);
  let inputLines;
  let totals;
  try {
    inputLines = validateInvoiceDraftLines(body?.lines);
    totals = calculateInvoiceTotals(inputLines);
  } catch {
    return responseError(
      400,
      "Revisa las líneas: descripción, cantidad, precio neto y descuento.",
    );
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return responseError(400, "Versión de borrador inválida.");
  }

  const currentResult = await supabaseAdmin
    .from("dte_invoice_drafts")
    .select("id,customer_id,status,version,payment_amount_snapshot")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();
  const current = currentResult.data;
  if (currentResult.error || !current) return responseError(404, "Borrador no encontrado.");
  if (!["DRAFT", "REVIEW_REQUIRED", "VALIDATED"].includes(current.status)) {
    return responseError(409, "El documento ya está bloqueado para edición.");
  }
  if (Number(current.version) !== expectedVersion) {
    return responseError(409, "El borrador cambió; vuelve a cargarlo antes de guardar.");
  }

  const serviceIds = [...new Set(
    totals.lines.map((line) => line.serviceId).filter((value): value is string => Boolean(value)),
  )];
  const appointmentIds = [...new Set(
    totals.lines
      .map((line) => line.appointmentId)
      .filter((value): value is string => Boolean(value)),
  )];
  const [servicesResult, appointmentsResult] = await Promise.all([
    serviceIds.length
      ? supabaseAdmin
          .from("services")
          .select("id,price")
          .eq("tenant_id", auth.tenantId)
          .in("id", serviceIds)
      : { data: [], error: null },
    appointmentIds.length
      ? supabaseAdmin
          .from("appointments")
          .select("id")
          .eq("tenant_id", auth.tenantId)
          .eq("customer_id", current.customer_id)
          .in("id", appointmentIds)
      : { data: [], error: null },
  ]);
  if (
    servicesResult.error ||
    appointmentsResult.error ||
    (servicesResult.data ?? []).length !== serviceIds.length ||
    (appointmentsResult.data ?? []).length !== appointmentIds.length
  ) {
    return responseError(404, "Un servicio o reserva no pertenece a este negocio.");
  }
  try {
    inputLines = inputLines.map((line) => {
      if (!line.serviceId || line.pricingMode !== "catalog_gross") return line;
      const service = servicesResult.data?.find((item) => item.id === line.serviceId);
      if (!service) throw new Error("DTE_CATALOG_SERVICE_REQUIRED");
      return {
        ...line,
        catalogUnitGrossAmount: Number(service.price),
      };
    });
    totals = calculateInvoiceTotals(inputLines);
  } catch {
    return responseError(
      409,
      "Los precios brutos del catálogo no se pueden reconciliar con el total IVA incluido.",
    );
  }

  const paymentMismatch =
    current.payment_amount_snapshot !== null &&
    Number(current.payment_amount_snapshot) !== totals.totalAmount;
  const deleteResult = await supabaseAdmin
    .from("dte_invoice_draft_lines")
    .delete()
    .eq("tenant_id", auth.tenantId)
    .eq("draft_id", id);
  if (deleteResult.error) return responseError(500, "No se pudieron actualizar las líneas.");
  const insertResult = await supabaseAdmin.from("dte_invoice_draft_lines").insert(
    totals.lines.map((line) => ({
      tenant_id: auth.tenantId,
      draft_id: id,
      service_id: line.serviceId,
      appointment_id: line.appointmentId,
      position: line.position,
      description: line.description,
      quantity: line.quantity,
      unit_net_amount: line.unitNetAmount,
      discount_basis_points: line.discountBasisPoints,
      pricing_mode: line.pricingMode,
      catalog_unit_gross_amount: line.catalogUnitGrossAmount,
      discount_amount: line.discountAmount,
      net_amount: line.netAmount,
      tax_amount: line.taxAmount,
      total_amount: line.totalAmount,
      catalog_snapshot:
        line.pricingMode === "catalog_gross"
          ? {
              serviceId: line.serviceId,
              unitGrossAmount: line.catalogUnitGrossAmount,
              capturedAs: "catalog_gross",
            }
          : {},
    })),
  );
  if (insertResult.error) {
    return responseError(
      500,
      "Las líneas no pudieron guardarse; vuelve a abrir el borrador.",
    );
  }
  const updateResult = await supabaseAdmin
    .from("dte_invoice_drafts")
    .update({
      status: paymentMismatch ? "REVIEW_REQUIRED" : "DRAFT",
      net_amount: totals.netAmount,
      tax_amount: totals.taxAmount,
      total_amount: totals.totalAmount,
      review_reason: paymentMismatch
        ? "El total de la factura no coincide exactamente con el pago confirmado."
        : null,
      version: expectedVersion + 1,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .eq("version", expectedVersion)
    .in("status", ["DRAFT", "REVIEW_REQUIRED", "VALIDATED"])
    .select(
      "id,status,version,net_amount,tax_amount,total_amount,review_reason,updated_at",
    )
    .single();
  if (updateResult.error || !updateResult.data) {
    return responseError(409, "El borrador cambió durante el guardado.");
  }
  return NextResponse.json({ ok: true, draft: updateResult.data });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return responseError(auth.status, auth.error);
  const { id } = await context.params;
  const result = await supabaseAdmin
    .from("dte_invoice_drafts")
    .update({
      status: "CANCELED",
      locked_at: new Date().toISOString(),
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .in("status", ["DRAFT", "REVIEW_REQUIRED", "VALIDATED"])
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) {
    return responseError(409, "El borrador ya no se puede cancelar.");
  }
  return NextResponse.json({ ok: true });
}
