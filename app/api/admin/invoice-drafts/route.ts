export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import { loadAdminAppointmentDocumentContexts } from "@/lib/dte/admin-appointment-document-context";
import { checkManualBoleta39IssuanceReadiness } from "@/lib/dte/boleta39-manual-gate";
import {
  calculateDocumentDraftTotals,
  validateInvoiceDraftLines,
} from "@/lib/dte/invoice-drafts";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function errorResponse(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function loadTaxPreviews(tenantId: string, customerId: string) {
  const [issuerResult, recipientResult] = await Promise.all([
    supabaseAdmin
      .from("dte_production_tenant_settings")
      .select(
        "issuer_rut,issuer_legal_name,issuer_activity,issuer_address,issuer_commune,issuer_city",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("customer_tax_profiles")
      .select(
        "rut_normalized,legal_name,business_activity,tax_address,tax_commune,tax_city,tax_email",
      )
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .maybeSingle(),
  ]);
  if (issuerResult.error || recipientResult.error) {
    throw new Error("DTE_TAX_PROFILE_UNAVAILABLE");
  }
  const issuer = issuerResult.data
    ? {
        rut: issuerResult.data.issuer_rut,
        legalName: issuerResult.data.issuer_legal_name,
        businessActivity: issuerResult.data.issuer_activity,
        address: issuerResult.data.issuer_address,
        commune: issuerResult.data.issuer_commune,
        city: issuerResult.data.issuer_city,
      }
    : {};
  const recipient = recipientResult.data
    ? {
        rut: recipientResult.data.rut_normalized,
        legalName: recipientResult.data.legal_name,
        businessActivity: recipientResult.data.business_activity,
        address: recipientResult.data.tax_address,
        commune: recipientResult.data.tax_commune,
        city: recipientResult.data.tax_city,
        email: recipientResult.data.tax_email,
      }
    : {};
  const required = ["rut", "legalName", "businessActivity", "address", "commune", "city"];
  return {
    issuer,
    recipient,
    complete:
      required.every((key) => Boolean((issuer as Record<string, unknown>)[key])) &&
      required.every((key) => Boolean((recipient as Record<string, unknown>)[key])),
  };
}

async function loadDrafts(tenantId: string) {
  const draftsResult = await supabaseAdmin
    .from("dte_invoice_drafts")
    .select(
      "id,customer_id,appointment_id,payment_intent_id,dte_type,source,status,version,issuer_preview,recipient_preview,issuer_snapshot,recipient_snapshot,net_amount,tax_amount,total_amount,review_reason,operational_reason,intent_id,locked_at,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (draftsResult.error) throw new Error("DTE_DRAFTS_UNAVAILABLE");
  const ids = (draftsResult.data ?? []).map((draft) => draft.id);
  const linesResult = ids.length
    ? await supabaseAdmin
        .from("dte_invoice_draft_lines")
        .select(
          "id,draft_id,service_id,appointment_id,position,description,quantity,unit_net_amount,discount_basis_points,discount_amount,net_amount,tax_amount,total_amount,pricing_mode,catalog_unit_gross_amount,catalog_snapshot",
        )
        .eq("tenant_id", tenantId)
        .in("draft_id", ids)
        .order("position")
    : { data: [], error: null };
  if (linesResult.error) throw new Error("DTE_DRAFT_LINES_UNAVAILABLE");
  return (draftsResult.data ?? []).map((draft) => ({
    ...draft,
    lines: (linesResult.data ?? []).filter((line) => line.draft_id === draft.id),
  }));
}

export async function GET(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.error);
  try {
    return NextResponse.json({
      ok: true,
      drafts: await loadDrafts(auth.tenantId),
    });
  } catch {
    return errorResponse(503, "No se pudieron cargar los borradores.");
  }
}

export async function POST(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return errorResponse(auth.status, auth.error);
  const body = await req.json().catch(() => null);
  const customerId = String(body?.customerId ?? "");
  const appointmentId = body?.appointmentId ? String(body.appointmentId) : null;
  const paymentIntentId = body?.paymentIntentId
    ? String(body.paymentIntentId)
    : null;
  const source = String(body?.source ?? "manual");
  const operationalReason = String(body?.operationalReason ?? "").trim().slice(0, 500);
  const dteType = Number(body?.dteType ?? 33);
  if (
    !isUuid(customerId) ||
    (appointmentId !== null && !isUuid(appointmentId)) ||
    (paymentIntentId !== null && !isUuid(paymentIntentId)) ||
    !["manual", "appointment", "payment"].includes(source) ||
    ![33, 39].includes(dteType)
  ) {
    return errorResponse(400, "Los datos del borrador no son válidos.");
  }

  let inputLines;
  let totals;
  try {
    inputLines = validateInvoiceDraftLines(body?.lines);
    totals = calculateDocumentDraftTotals(dteType as 33 | 39, inputLines);
  } catch {
    return errorResponse(
      400,
      "Revisa las líneas: descripción, cantidad, precio neto y descuento.",
    );
  }

  const customerResult = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("id", customerId)
    .maybeSingle();
  if (customerResult.error || !customerResult.data) {
    return errorResponse(404, "Cliente no encontrado.");
  }

  const serviceIds = [...new Set(
    inputLines.map((line) => line.serviceId).filter((id): id is string => Boolean(id)),
  )];
  const appointmentIds = [...new Set([
    ...(appointmentId ? [appointmentId] : []),
    ...inputLines
      .map((line) => line.appointmentId)
      .filter((id): id is string => Boolean(id)),
  ])];
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
          .select("id,customer_id,payment_status,payment_paid_amount")
          .eq("tenant_id", auth.tenantId)
          .eq("customer_id", customerId)
          .in("id", appointmentIds)
      : { data: [], error: null },
  ]);
  if (
    servicesResult.error ||
    appointmentsResult.error ||
    (servicesResult.data ?? []).length !== serviceIds.length ||
    (appointmentsResult.data ?? []).length !== appointmentIds.length
  ) {
    return errorResponse(404, "Un servicio o reserva no pertenece a este negocio.");
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
    totals = calculateDocumentDraftTotals(dteType as 33 | 39, inputLines);
  } catch {
    return errorResponse(
      409,
      "Los precios brutos del catálogo no se pueden reconciliar con el total IVA incluido.",
    );
  }

  if (appointmentId && source !== "manual") {
    let context;
    try {
      [context] = await loadAdminAppointmentDocumentContexts(
        auth.tenantId,
        [appointmentId],
      );
    } catch {
      return errorResponse(503, "No se pudo validar el estado tributario de la reserva.");
    }
    if (!context?.saleId || !context.customerId || context.customerId !== customerId) {
      return errorResponse(409, "La reserva no coincide con la venta y cliente persistidos.");
    }
    if (context.intent) {
      return errorResponse(409, "Ya existe un proceso tributario para esta venta.");
    }
    if (context.activeDraft) {
      return errorResponse(409, "Ya existe un borrador tributario para esta reserva.");
    }
    if (context.hasActiveCoverage) {
      return errorResponse(409, "La venta ya tiene cobertura tributaria asociada.");
    }
    if (
      context.requestedDocumentType !== null &&
      context.requestedDocumentType !== dteType
    ) {
      return errorResponse(
        409,
        context.requestedDocumentType === 33
          ? "La venta tiene Factura 33 solicitada; no puede prepararse como Boleta 39."
          : "La venta tiene Boleta 39 solicitada; no puede prepararse como Factura 33.",
      );
    }
    if (String(context.paymentState ?? "").toUpperCase() !== "PAID") {
      return errorResponse(409, "La venta debe estar pagada antes de preparar el documento.");
    }
    if (
      context.totalAmount === null ||
      Number(context.totalAmount) !== Number(totals.totalAmount)
    ) {
      return errorResponse(
        409,
        "El total del borrador no coincide exactamente con la venta persistida.",
      );
    }
  }

  if (
    source === "appointment" &&
    !appointmentsResult.data?.some(
      (appointment) =>
        appointment.id === appointmentId &&
        String(appointment.payment_status).toLowerCase() === "paid",
    )
  ) {
    return errorResponse(409, "La reserva debe estar completamente pagada.");
  }

  let paymentAmount: number | null = null;
  if (source === "appointment") {
    const paidAppointment = appointmentsResult.data?.find(
      (appointment) => appointment.id === appointmentId,
    );
    paymentAmount = Number(paidAppointment?.payment_paid_amount ?? 0) || null;
  }
  if (paymentIntentId) {
    const paymentResult = await supabaseAdmin
      .from("payment_intents")
      .select("id,appointment_id,amount,currency,status")
      .eq("tenant_id", auth.tenantId)
      .eq("id", paymentIntentId)
      .eq("status", "succeeded")
      .maybeSingle();
    if (
      paymentResult.error ||
      !paymentResult.data ||
      paymentResult.data.currency !== "CLP" ||
      (appointmentId && paymentResult.data.appointment_id !== appointmentId)
    ) {
      return errorResponse(409, "El pago no está confirmado o no corresponde al borrador.");
    }
    paymentAmount = Number(paymentResult.data.amount);
  }

  let tax;
  try {
    tax = await loadTaxPreviews(auth.tenantId, customerId);
  } catch {
    return errorResponse(503, "No se pudieron cargar los datos tributarios actuales.");
  }
  const gateCheck = dteType === 39
    ? await checkManualBoleta39IssuanceReadiness({
        tenantId: auth.tenantId,
        dteType: 39,
        issuanceOrigin: "manual_admin",
      })
    : null;

  const reviewReason = dteType === 39
    ? gateCheck?.ready
      ? null
      : (gateCheck?.blockingCodes[0] ?? "BOLETA39_GATE_BLOCKED")
    : !tax.complete
    ? "Completa los datos tributarios del emisor o receptor."
    : paymentAmount !== null && paymentAmount !== totals.totalAmount
      ? "El total de la factura no coincide exactamente con el pago confirmado."
      : null;

  const draftResult = await supabaseAdmin
    .from("dte_invoice_drafts")
    .insert({
      tenant_id: auth.tenantId,
      customer_id: customerId,
      appointment_id: appointmentId,
      payment_intent_id: paymentIntentId,
      source,
      dte_type: dteType,
      status: reviewReason ? "REVIEW_REQUIRED" : "DRAFT",
      issuer_preview: tax.issuer,
      recipient_preview: tax.recipient,
      net_amount: totals.netAmount,
      tax_amount: totals.taxAmount,
      total_amount: totals.totalAmount,
      payment_amount_snapshot: paymentAmount,
      review_reason: reviewReason,
      operational_reason:
        operationalReason ||
        (source === "manual"
          ? `${dteType === 39 ? "Boleta" : "Factura"} manual creada desde el editor`
          : null),
      created_by: auth.userId,
      updated_by: auth.userId,
    })
    .select("id")
    .single();
  if (draftResult.error || !draftResult.data) {
    return errorResponse(
      draftResult.error?.code === "23505" ? 409 : 500,
      "No se pudo guardar el borrador.",
    );
  }

  const draftId = draftResult.data.id;
  const linesResult = await supabaseAdmin.from("dte_invoice_draft_lines").insert(
    totals.lines.map((line, index) => ({
      tenant_id: auth.tenantId,
      draft_id: draftId,
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
        dteType === 39
          ? {
              serviceId: line.serviceId,
              unitGrossAmount:
                inputLines[index].pricingMode === "catalog_gross"
                  ? inputLines[index].catalogUnitGrossAmount
                  : inputLines[index].unitNetAmount,
              capturedAs:
                inputLines[index].pricingMode === "catalog_gross"
                  ? "catalog_gross"
                  : "manual_gross",
              taxTreatment: inputLines[index].taxTreatment ?? "affected",
            }
          : line.pricingMode === "catalog_gross"
          ? {
              serviceId: line.serviceId,
              unitGrossAmount: line.catalogUnitGrossAmount,
              capturedAs: "catalog_gross",
            }
          : {},
    })),
  );
  if (linesResult.error) {
    await supabaseAdmin
      .from("dte_invoice_drafts")
      .delete()
      .eq("tenant_id", auth.tenantId)
      .eq("id", draftId)
      .eq("status", reviewReason ? "REVIEW_REQUIRED" : "DRAFT");
    return errorResponse(500, "No se pudieron guardar las líneas del borrador.");
  }
  const drafts = await loadDrafts(auth.tenantId);
  return NextResponse.json(
    { ok: true, draft: drafts.find((draft) => draft.id === draftId) },
    { status: 201 },
  );
}
