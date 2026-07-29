export const runtime = "nodejs";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import {
  manualIssuanceIdempotencyMaterial,
  normalizeRequiredCustomerRut,
  normalizeTaxProfile,
} from "@/lib/dte/cutover";
import {
  calculateManualMoney,
  manualReviewMaterial,
  type ManualGrossLine,
  validateManualGrossLines,
} from "@/lib/dte/manual-money";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type AppointmentRow = {
  id: string;
  customer_id: string | null;
  service_id: string | null;
  service_name: string | null;
  service_price: number | null;
  price: number | null;
  payment_paid_amount: number | null;
  payment_status: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_rut_snapshot: string | null;
  invoice_receiver_rut: string | null;
  invoice_receiver_legal_name: string | null;
  invoice_receiver_activity: string | null;
  invoice_receiver_address: string | null;
  invoice_receiver_commune: string | null;
  invoice_receiver_city: string | null;
  tax_treatment_snapshot: string | null;
};

function responseError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return responseError(auth.status === 403 ? 404 : auth.status, auth.error);
  const body = await req.json().catch(() => null);
  const previewOnly = body?.previewOnly === true;
  const source = String(body?.source ?? "");
  const dteType = Number(body?.dteType);
  const customerId = String(body?.customerId ?? "");
  const appointmentId = body?.appointmentId ? String(body.appointmentId) : null;
  const paymentIntentId = body?.paymentIntentId ? String(body.paymentIntentId) : null;
  const key = String(req.headers.get("idempotency-key") ?? body?.idempotencyKey ?? "").trim();
  if (
    !["appointment", "payment", "standalone", "credit_note", "debit_note"].includes(source) ||
    ![33, 39, 56, 61].includes(dteType) ||
    !isUuid(customerId) ||
    (!previewOnly && (
      !/^[A-Za-z0-9:_-]{16,128}$/.test(key) ||
      body?.reviewAccepted !== true
    ))
  ) return responseError(400, "Solicitud de emisión inválida");

  const { data: customer } = await supabaseAdmin.from("customers")
    .select("id,full_name,email,rut_normalized")
    .eq("tenant_id", auth.tenantId).eq("id", customerId).maybeSingle();
  if (!customer) return responseError(404, "Recurso no encontrado");
  try {
    normalizeRequiredCustomerRut(customer.rut_normalized);
  } catch {
    return responseError(409, "Completa el RUT válido del cliente antes de solicitar un documento");
  }

  let appointment: AppointmentRow | null = null;
  let verifiedPayment: Record<string, unknown> | null = null;
  if (appointmentId) {
    if (!isUuid(appointmentId)) return responseError(404, "Recurso no encontrado");
    const result = await supabaseAdmin.from("appointments")
      .select("id,customer_id,service_id,service_name,service_price,price,payment_paid_amount,payment_status,customer_name,customer_email,customer_rut_snapshot,invoice_receiver_rut,invoice_receiver_legal_name,invoice_receiver_activity,invoice_receiver_address,invoice_receiver_commune,invoice_receiver_city,tax_treatment_snapshot")
      .eq("tenant_id", auth.tenantId).eq("id", appointmentId)
      .eq("customer_id", customerId).maybeSingle();
    appointment = result.data as AppointmentRow | null;
    if (!appointment) return responseError(404, "Recurso no encontrado");
  }
  if (paymentIntentId) {
    if (!isUuid(paymentIntentId)) return responseError(404, "Recurso no encontrado");
    const result = await supabaseAdmin.from("payment_intents")
      .select("id,tenant_id,appointment_id,amount,currency,status,provider,provider_payment_id")
      .eq("tenant_id", auth.tenantId).eq("id", paymentIntentId).eq("status", "succeeded")
      .maybeSingle();
    verifiedPayment = result.data;
    if (!verifiedPayment || (appointmentId && verifiedPayment.appointment_id !== appointmentId)) {
      return responseError(404, "Recurso no encontrado");
    }
  }
  if (source === "payment" && (!verifiedPayment || !appointment)) {
    return responseError(400, "El pago verificado y su reserva son obligatorios");
  }
  if (source === "appointment" && !appointment) {
    return responseError(400, "La reserva es obligatoria");
  }
  if (source === "appointment" && String(appointment?.payment_status ?? "").toLowerCase() !== "paid") {
    return responseError(409, "Confirma el pago manual o en efectivo antes de generar la intención");
  }

  const operationalReason = String(body?.operationalReason ?? "").trim().slice(0, 500);
  let lines: ManualGrossLine[];
  if (source === "standalone") {
    if (operationalReason.length < 10) return responseError(400, "Motivo operacional obligatorio");
    try {
      lines = validateManualGrossLines(body?.lines);
    } catch {
      return responseError(400, "Detalle o montos inválidos");
    }
  } else {
    const grossAmountFromDatabase = Number(
      verifiedPayment?.amount ??
      appointment?.payment_paid_amount ??
      appointment?.service_price ??
      appointment?.price,
    );
    if (!Number.isSafeInteger(grossAmountFromDatabase) || grossAmountFromDatabase <= 0) {
      return responseError(409, "El monto server-side no está disponible");
    }
    lines = [{
      description: String(appointment?.service_name ?? "Servicio").slice(0, 180),
      quantity: 1,
      unitGrossAmount: grossAmountFromDatabase,
      grossAmount: grossAmountFromDatabase,
    }];
  }
  const money = calculateManualMoney(
    lines,
    appointment?.tax_treatment_snapshot === "exempt",
  );

  let receiver: Record<string, unknown> = {
    rut: customer.rut_normalized,
    legalName: customer.full_name,
    email: customer.email,
  };
  if (dteType === 33) {
    const { data: storedProfile } = await supabaseAdmin.from("customer_tax_profiles")
      .select("rut_normalized,legal_name,business_activity,tax_address,tax_commune,tax_city,tax_email")
      .eq("tenant_id", auth.tenantId).eq("customer_id", customerId).maybeSingle();
    try {
      const profile = normalizeTaxProfile(storedProfile ? {
        rut: storedProfile.rut_normalized,
        legalName: storedProfile.legal_name,
        businessActivity: storedProfile.business_activity,
        address: storedProfile.tax_address,
        commune: storedProfile.tax_commune,
        city: storedProfile.tax_city,
        taxEmail: storedProfile.tax_email,
      } : null);
      receiver = profile;
    } catch {
      return responseError(409, "Completa el perfil tributario del cliente");
    }
  }

  let originalProductionDocumentId: string | null = null;
  if (dteType === 56 || dteType === 61) {
    originalProductionDocumentId = String(body?.originalProductionDocumentId ?? "");
    if (!isUuid(originalProductionDocumentId)) {
      return responseError(400, "Documento original válido obligatorio");
    }
    const { data: original } = await supabaseAdmin.from("dte_payment_document_intents")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("production_document_id", originalProductionDocumentId)
      .eq("status", "ACCEPTED")
      .maybeSingle();
    if (!original) return responseError(404, "Recurso no encontrado");
  }

  const [{ data: issuer }, { data: authorization }, { data: activation }, gateResult] = await Promise.all([
    supabaseAdmin.from("dte_production_tenant_settings")
      .select("issuer_rut,issuer_legal_name,issuer_activity,issuer_address,issuer_commune,issuer_city")
      .eq("tenant_id", auth.tenantId).maybeSingle(),
    supabaseAdmin.from("dte_sii_authorization_evidence")
      .select("authorized_types,status").eq("tenant_id", auth.tenantId).eq("status", "current").maybeSingle(),
    supabaseAdmin.from("dte_legal_activation")
      .select("status").eq("tenant_id", auth.tenantId).eq("dte_type", dteType).maybeSingle(),
    supabaseAdmin.rpc("dte_activation_gate_report", {
      p_tenant_id: auth.tenantId,
      p_dte_type: dteType,
      p_global_feature_enabled: process.env.DTE_PRODUCTION_ENABLED === "true",
    }),
  ]);
  const typeAuthorized = Array.isArray(authorization?.authorized_types) &&
    authorization.authorized_types.includes(dteType);
  const gate = gateResult.data as { ready?: boolean } | null;
  const active = !gateResult.error && gate?.ready === true && activation?.status === "active";
  const reason = !typeAuthorized
    ? (dteType === 39 ? "BLOCKED_NOT_AUTHORIZED" : "DOCUMENT_TYPE_NOT_AUTHORIZED")
    : !active
      ? "LEGAL_ISSUANCE_NOT_ACTIVE"
      : null;
  const reviewFingerprint = sha256(manualReviewMaterial({
    tenantId: auth.tenantId,
    source,
    dteType,
    customerId,
    appointmentId,
    paymentIntentId,
    lines,
    money,
  }));
  if (previewOnly) {
    return NextResponse.json({
      ok: true,
      preview: {
        source,
        dteType,
        receiver,
        issuer,
        lines,
        money,
        reviewFingerprint,
        blockingReason: reason,
      },
    });
  }
  if (String(body?.reviewFingerprint ?? "") !== reviewFingerprint) {
    return responseError(409, "La revisión cambió; vuelve a previsualizar antes de emitir");
  }
  const idempotencyKey = sha256(manualIssuanceIdempotencyMaterial({
    tenantId: auth.tenantId,
    key,
    appointmentId,
    paymentIntentId,
    customerId,
    dteType,
  }));
  const snapshot = {
    tenantId: auth.tenantId,
    issuer,
    receiver,
    lines,
    money,
    appointment: appointment ? { id: appointment.id, serviceId: appointment.service_id } : null,
    payment: verifiedPayment ? {
      id: verifiedPayment.id,
      provider: verifiedPayment.provider,
      amount: verifiedPayment.amount,
      currency: verifiedPayment.currency,
    } : null,
    documentType: dteType,
    requestedBy: auth.userId,
    requestedByRole: auth.authMode,
    origin: source,
    requestedAt: new Date().toISOString(),
    operationalReason: operationalReason || null,
  };
  const origin = source === "standalone" ? "manual_standalone"
    : source === "payment" ? "manual_payment"
      : source === "credit_note" ? "credit_note"
        : source === "debit_note" ? "debit_note"
          : "manual_appointment";
  const { data: inserted, error } = await supabaseAdmin.from("dte_payment_document_intents")
    .insert({
      tenant_id: auth.tenantId,
      appointment_id: appointmentId,
      payment_intent_id: paymentIntentId,
      customer_id: customerId,
      payment_key: paymentIntentId ? `manual:${paymentIntentId}` : `manual:${idempotencyKey}`,
      trigger_source: "manual_admin",
      idempotency_key: idempotencyKey,
      requested_document: dteType === 33 ? "invoice" : "consumer",
      resolved_dte_type: dteType,
      amount_snapshot: money.grossAmount,
      currency: "CLP",
      appointment_snapshot: snapshot.appointment ?? {},
      receiver_snapshot: receiver,
      immutable_snapshot: snapshot,
      origin,
      operational_reason: operationalReason || null,
      original_production_document_id: originalProductionDocumentId,
      status: reason ? "BLOCKED" : "PENDING",
      safe_blocking_reason: reason,
      created_by: auth.userId,
      requested_by_role: auth.authMode === "platform_admin" ? "platform_admin" : "tenant_admin",
    })
    .select("id,status,safe_blocking_reason,amount_snapshot,resolved_dte_type,immutable_snapshot")
    .single();
  if (error) {
    const { data: existing } = await supabaseAdmin.from("dte_payment_document_intents")
      .select("id,status,safe_blocking_reason,amount_snapshot,resolved_dte_type,immutable_snapshot")
      .eq("tenant_id", auth.tenantId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing) return NextResponse.json({ ok: true, intent: existing, duplicate: true });
    return responseError(409, "La emisión ya existe o los datos son incompatibles");
  }
  return NextResponse.json({ ok: true, intent: inserted, duplicate: false }, { status: 201 });
}
