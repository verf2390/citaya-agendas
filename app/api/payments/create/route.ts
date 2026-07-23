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
import { calculatePaymentBreakdown } from "@/services/payments/payment-mode";
import {
  getPaymentProvider,
  isPaymentProviderId,
} from "@/services/payments/provider-factory";
import type { PaymentProviderConfig } from "@/services/payments/providers/types";

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
        "id, tenant_id, service_id, service_name, customer_name, customer_email, status, payment_status, payment_url, payment_reference, service_price, currency, manage_token, manage_token_hash, manage_token_expires_at, manage_token_revoked_at, manage_token_legacy_expires_at",
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

    const [{ data: service, error: serviceError }, paymentConfig] = await Promise.all([
      supabaseAdmin
        .from("services")
        .select("id, tenant_id, name, price, currency, is_active")
        .eq("id", appointment.service_id)
        .eq("tenant_id", appointment.tenant_id)
        .eq("is_active", true)
        .maybeSingle(),
      getTenantPaymentConfig(appointment.tenant_id),
    ]);
    if (serviceError || !service) return jsonError(404);
    const bookedAmount = Number(appointment.service_price ?? service.price);
    if (!Number.isFinite(bookedAmount) || bookedAmount < 0) return jsonError(409);
    const config = providerConfig(providerId, paymentConfig);
    if (!paymentConfig.enabled || paymentConfig.collectionMode === "none" || !config.enabled) {
      return jsonError(409);
    }

    const breakdown = calculatePaymentBreakdown({
      totalAmount: bookedAmount,
      paymentMode: paymentConfig.collectionMode,
      depositType: paymentConfig.depositType,
      depositValue: paymentConfig.depositValue,
    });
    if (!Number.isFinite(breakdown.requiredOnlineAmount) || breakdown.requiredOnlineAmount <= 0) {
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
      amount: breakdown.requiredOnlineAmount,
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
      title: appointment.service_name || service.name || "Reserva",
      amount: breakdown.requiredOnlineAmount,
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
        p_remaining_amount: breakdown.remainingAmount,
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
