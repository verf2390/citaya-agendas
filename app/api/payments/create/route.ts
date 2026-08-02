import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { authorizeAppointmentActor } from "@/lib/api/appointmentAccess";
import {
  consumeRateLimit,
  idempotencyKey,
  opaqueKey,
  requestIp,
} from "@/lib/security/request";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";
import {
  getPaymentProvider,
  isPaymentProviderId,
} from "@/services/payments/provider-factory";
import type { PaymentProviderConfig } from "@/services/payments/providers/types";
import { normalizeRut, validateRut } from "@/lib/dte/rut";

function jsonError(status: number, error = "No se pudo iniciar el pago") {
  return NextResponse.json({ ok: false, error }, { status });
}

function providerConfig(
  provider: PaymentProviderConfig["id"],
  paymentConfig: Awaited<ReturnType<typeof getTenantPaymentConfig>>,
): PaymentProviderConfig {
  return {
    id: provider,
    enabled: paymentConfig.paymentMethodsEnabled.includes(provider),
    credentials: provider === "mercadopago"
      ? { accessToken: paymentConfig.accessToken }
      : undefined,
  };
}

export async function POST(req: Request) {
  let createdIntentId = "";
  try {
    const body = await req.json().catch(() => null);
    const appointmentId = String(body?.appointmentId ?? "").trim();
    const providerId = String(body?.provider ?? "mercadopago").trim();
    const requestKey = idempotencyKey(req, body?.idempotencyKey);
    if (!isUuid(appointmentId) || !isPaymentProviderId(providerId) || !requestKey) {
      return jsonError(400, "Solicitud de pago inválida");
    }

    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from("appointments")
      .select(
        "id,tenant_id,service_id,service_name,customer_id,customer_rut_snapshot,customer_name,customer_email,status,payment_status,payment_policy_snapshot,deposit_tax_document_policy_status_snapshot,payment_url,payment_reference,service_price,currency,requested_document_type,manage_token,manage_token_hash,manage_token_expires_at,manage_token_revoked_at,manage_token_legacy_expires_at",
      )
      .eq("id", appointmentId)
      .maybeSingle();
    if (appointmentError || !appointment) return jsonError(404);

    const actor = await authorizeAppointmentActor({
      req,
      appointment,
      manageToken: body?.manageToken,
    });
    if (!actor.ok) return jsonError(404);
    if (["canceled", "cancelled"].includes(String(appointment.status).toLowerCase())) {
      return jsonError(409);
    }
    if (!appointment.service_id || String(appointment.payment_status) === "paid") {
      return jsonError(409);
    }
    if (appointment.payment_policy_snapshot === "deposit" || appointment.requested_document_type === 39) {
      const { data: taxPolicy, error: taxPolicyError } = await supabaseAdmin.from("dte_tenant_issuance_settings")
        .select("deposit_tax_document_policy_status,boleta_payment_document_model,boleta_model_verified_at,boleta_model_verified_by,boleta_model_evidence_reference")
        .eq("tenant_id", appointment.tenant_id).maybeSingle();
      if (taxPolicyError) {
        return jsonError(409, "El pago no está disponible por ahora.");
      }
      if (appointment.payment_policy_snapshot === "deposit" &&
          (appointment.deposit_tax_document_policy_status_snapshot !== "enabled" ||
           taxPolicy?.deposit_tax_document_policy_status !== "enabled")) {
        return jsonError(409, "El pago anticipado no está disponible por ahora.");
      }
      if (appointment.requested_document_type === 39 &&
          (!taxPolicy || taxPolicy.boleta_payment_document_model === "unconfigured" ||
           !taxPolicy.boleta_model_verified_at || !taxPolicy.boleta_model_verified_by ||
           String(taxPolicy.boleta_model_evidence_reference ?? "").trim().length < 3)) {
        return jsonError(409, "El pago no está disponible por ahora.");
      }
    }

    if (actor.actor === "manage_token") {
      const { data: legalReady, error: legalReadyError } = await supabaseAdmin.rpc(
        "legal_appointment_payment_ready",
        { p_tenant_id: appointment.tenant_id, p_appointment_id: appointment.id },
      );
      if (legalReadyError || legalReady !== true) {
        return jsonError(409, "La aceptación legal de la reserva está incompleta");
      }
    }

    let customerRut = String(appointment.customer_rut_snapshot ?? "");
    if (appointment.requested_document_type === 33 && !validateRut(customerRut) && appointment.customer_id) {
      const { data: customer } = await supabaseAdmin.from("customers")
        .select("rut_normalized").eq("tenant_id", appointment.tenant_id)
        .eq("id", appointment.customer_id).maybeSingle();
      customerRut = String(customer?.rut_normalized ?? body?.customerRut ?? "");
    }
    if (appointment.requested_document_type === 33 && !validateRut(customerRut)) {
      return jsonError(409, "Completa el RUT válido del cliente antes de pagar");
    }
    const normalizedCustomerRut = appointment.requested_document_type === 33 ? normalizeRut(customerRut) : "";
    if (appointment.requested_document_type === 33 && appointment.customer_id) {
      const customerUpdate = await supabaseAdmin.from("customers")
        .update({ rut_normalized: normalizedCustomerRut })
        .eq("tenant_id", appointment.tenant_id).eq("id", appointment.customer_id);
      if (customerUpdate.error) return jsonError(409, "No se pudo validar el RUT del cliente");
    }
    if (appointment.requested_document_type === 33 && appointment.customer_rut_snapshot !== normalizedCustomerRut) {
      const appointmentUpdate = await supabaseAdmin.from("appointments")
        .update({ customer_rut_snapshot: normalizedCustomerRut })
        .eq("tenant_id", appointment.tenant_id).eq("id", appointment.id);
      if (appointmentUpdate.error) return jsonError(409, "No se pudo completar el RUT de la reserva");
    }

    const allowed = await consumeRateLimit({
      scope: "payment_create",
      key: opaqueKey(requestIp(req), appointment.tenant_id, appointment.id),
      limit: 8,
      windowSeconds: 15 * 60,
    });
    if (!allowed) return jsonError(429, "Demasiadas solicitudes");

    const { data: existingIntent, error: existingIntentError } = await supabaseAdmin
      .from("payment_intents")
      .select("id, appointment_id, provider, status, provider_payment_id")
      .eq("tenant_id", appointment.tenant_id)
      .eq("idempotency_key", requestKey)
      .maybeSingle();
    if (existingIntentError) return jsonError(500);
    if (existingIntent) {
      if (existingIntent.provider !== providerId || existingIntent.appointment_id !== appointment.id) return jsonError(409);
      return NextResponse.json({
        ok: true,
        provider: providerId,
        payment_url: appointment.payment_url ?? null,
        reference: appointment.payment_reference ?? null,
        replay: true,
      });
    }

    const [{ data: service, error: serviceError }, paymentConfig, { data: saleLink }] = await Promise.all([
      supabaseAdmin
        .from("services")
        .select("id,tenant_id,name,currency,contains_potentially_sensitive_information")
        .eq("id", appointment.service_id)
        .eq("tenant_id", appointment.tenant_id)
        .maybeSingle(),
      getTenantPaymentConfig(appointment.tenant_id),
      supabaseAdmin.from("billing_sale_appointments").select("sale_id")
        .eq("tenant_id", appointment.tenant_id).eq("appointment_id", appointment.id).maybeSingle(),
    ]);
    if (serviceError || !service || !saleLink?.sale_id) return jsonError(404);
    const [{ data: sale }, { data: schedule }] = await Promise.all([
      supabaseAdmin.from("billing_sales").select("id,balance_due,payment_state,tax_treatment_status")
        .eq("tenant_id", appointment.tenant_id).eq("id", saleLink.sale_id).maybeSingle(),
      supabaseAdmin.from("billing_payment_schedule").select("id,amount,paid_amount,installment_kind,status")
        .eq("tenant_id", appointment.tenant_id).eq("sale_id", saleLink.sale_id)
        .in("status", ["PENDING", "PARTIALLY_PAID"])
        .order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const requiredAmount = Number(schedule ? Number(schedule.amount) - Number(schedule.paid_amount) : sale?.balance_due ?? 0);
    if (!sale || !Number.isSafeInteger(requiredAmount) || requiredAmount <= 0 || sale.payment_state === "PAID") return jsonError(409);
    const config = providerConfig(providerId, paymentConfig);
    if (!paymentConfig.enabled || !config.enabled) {
      return jsonError(409);
    }

    const intentId = crypto.randomUUID();
    createdIntentId = intentId;
    const compactIntent = intentId.replace(/-/g, "");
    const buyOrder = `CTY${compactIntent}`.slice(0, 26);
    const sessionId = `${appointment.tenant_id.replace(/-/g, "")}:${compactIntent}`.slice(0, 61);
    const currency = String(appointment.currency ?? service.currency ?? "CLP").trim().toUpperCase() || "CLP";
    const { error: intentError } = await supabaseAdmin.from("payment_intents").insert({
      id: intentId,
      tenant_id: appointment.tenant_id,
      appointment_id: appointment.id,
      provider: providerId,
      buy_order: providerId === "webpay" ? buyOrder : null,
      session_id: providerId === "webpay" ? sessionId : null,
      amount: requiredAmount,
      currency,
      status: "created",
      idempotency_key: requestKey,
    });
    if (intentError) return jsonError(intentError.code === "23505" ? 409 : 500);

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("base_url")
      .eq("id", appointment.tenant_id)
      .maybeSingle();
    const appUrl =
      String(tenant?.base_url ?? "").trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      new URL(req.url).origin;

    const providerNotificationUrl = new URL(
      providerId === "mercadopago" && process.env.MERCADOPAGO_WEBHOOK_URL
        ? process.env.MERCADOPAGO_WEBHOOK_URL
        : "/api/webhooks/" + providerId,
      appUrl,
    );
    if (providerId === "mercadopago") {
      providerNotificationUrl.searchParams.set("intent", intentId);
    }

    const payment = await getPaymentProvider(providerId).createPayment({
      paymentIntentId: intentId,
      appointmentId: appointment.id,
      tenantId: appointment.tenant_id,
      buyOrder,
      sessionId,
      title: service.contains_potentially_sensitive_information
        ? "Reserva de servicio"
        : appointment.service_name || service.name || "Reserva",
      amount: requiredAmount,
      currency,
      customerName: appointment.customer_name ?? null,
      customerEmail: appointment.customer_email ?? null,
      successUrl: providerId === "webpay"
        ? appUrl + "/api/payments/webpay/return"
        : appUrl + "/reservar/resultado?status=success&id=" + encodeURIComponent(appointment.id),
      failureUrl: appUrl + "/reservar/resultado?status=failure&id=" + encodeURIComponent(appointment.id),
      pendingUrl: appUrl + "/reservar/resultado?status=pending&id=" + encodeURIComponent(appointment.id),
      notificationUrl: providerNotificationUrl.toString(),
      config,
    });

    const { error: activationError } = await supabaseAdmin.rpc(
      "activate_payment_intent",
      {
        p_intent_id: intentId,
        p_provider_payment_id: payment.reference,
        p_payment_url: payment.paymentUrl,
        p_remaining_amount: Math.max(Number(sale.balance_due) - requiredAmount, 0),
      },
    );
    if (activationError) throw new Error("payment_activation_failed");

    return NextResponse.json({
      ok: true,
      provider: providerId,
      payment_url: payment.paymentUrl,
      reference: payment.reference,
      redirect_method: payment.redirectMethod ?? "GET",
      redirect_payload: payment.redirectPayload ?? null,
    });
  } catch (error) {
    if (createdIntentId) {
      await supabaseAdmin
        .from("payment_intents")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", createdIntentId)
        .eq("status", "created");
    }
    console.error("[payments/create] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(500);
  }
}
