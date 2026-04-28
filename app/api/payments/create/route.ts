import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";
import { calculatePaymentBreakdown } from "@/services/payments/payment-mode";
import {
  getPaymentProvider,
  isPaymentProviderId,
} from "@/services/payments/provider-factory";
import type { PaymentProviderConfig } from "@/services/payments/providers/types";

function buildProviderConfig(
  providerId: PaymentProviderConfig["id"],
  paymentConfig: Awaited<ReturnType<typeof getTenantPaymentConfig>>,
): PaymentProviderConfig {
  if (providerId === "mercadopago") {
    return {
      id: providerId,
      enabled: paymentConfig.paymentMethodsEnabled.includes(providerId),
      credentials: {
        accessToken: paymentConfig.accessToken,
      },
    };
  }

  if (providerId === "webpay") {
    return {
      id: providerId,
      enabled: paymentConfig.paymentMethodsEnabled.includes(providerId),
      credentials: {
        commerceCode: paymentConfig.webpayCommerceCode,
        apiKey: paymentConfig.webpayApiKey,
        environment: paymentConfig.webpayEnvironment,
      },
    };
  }

  if (providerId === "khipu") {
    return {
      id: providerId,
      enabled: paymentConfig.paymentMethodsEnabled.includes(providerId),
      credentials: {
        receiverId: paymentConfig.khipuReceiverId,
        secret: paymentConfig.khipuSecret,
        environment: paymentConfig.khipuEnvironment,
      },
    };
  }

  return {
    id: providerId,
    enabled: paymentConfig.paymentMethodsEnabled.includes(providerId),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const appointmentId = String(body?.appointmentId ?? "").trim();
    const tenantId = body?.tenantId ? String(body.tenantId).trim() : "";
    const providerId = String(body?.provider ?? "mercadopago").trim();

    if (!appointmentId || !isUuid(appointmentId)) {
      return NextResponse.json(
        { ok: false, error: "appointmentId inválido" },
        { status: 400 },
      );
    }

    if (tenantId && !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId inválido" },
        { status: 400 },
      );
    }

    if (!isPaymentProviderId(providerId)) {
      return NextResponse.json(
        { ok: false, error: "Proveedor de pago inválido" },
        { status: 400 },
      );
    }

    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from("appointments")
      .select(
        "id, tenant_id, service_id, service_name, customer_name, customer_email, status",
      )
      .eq("id", appointmentId)
      .single();

    if (appointmentError || !appointment) {
      return NextResponse.json(
        { ok: false, error: "Cita no encontrada" },
        { status: 404 },
      );
    }

    if (tenantId && appointment.tenant_id !== tenantId) {
      return NextResponse.json(
        { ok: false, error: "Tenant mismatch para la cita" },
        { status: 403 },
      );
    }

    if (String(appointment.status ?? "").toLowerCase() === "canceled") {
      return NextResponse.json(
        { ok: false, error: "No se puede pagar una cita cancelada" },
        { status: 409 },
      );
    }

    if (!appointment.service_id) {
      return NextResponse.json(
        { ok: false, error: "La cita no tiene service_id asociado" },
        { status: 400 },
      );
    }

    const paymentConfig = await getTenantPaymentConfig(appointment.tenant_id);
    const providerConfig = buildProviderConfig(providerId, paymentConfig);

    if (!paymentConfig.enabled || paymentConfig.collectionMode === "none") {
      return NextResponse.json(
        { ok: false, error: "Pagos no habilitados para este tenant" },
        { status: 400 },
      );
    }

    if (!providerConfig.enabled) {
      return NextResponse.json(
        { ok: false, error: "Proveedor no habilitado para este tenant" },
        { status: 400 },
      );
    }

    const { data: service, error: serviceError } = await supabaseAdmin
      .from("services")
      .select("id, tenant_id, name, price, currency")
      .eq("tenant_id", appointment.tenant_id)
      .eq("id", appointment.service_id)
      .single();

    if (serviceError || !service) {
      return NextResponse.json(
        { ok: false, error: "Servicio de la cita no encontrado" },
        { status: 404 },
      );
    }

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("base_url, slug")
      .eq("id", appointment.tenant_id)
      .maybeSingle();

    const breakdown = calculatePaymentBreakdown({
      totalAmount: service.price ?? 0,
      paymentMode: paymentConfig.collectionMode,
      depositType: paymentConfig.depositType,
      depositValue: paymentConfig.depositValue,
    });

    if (breakdown.requiredOnlineAmount <= 0) {
      return NextResponse.json(
        { ok: false, error: "Este tenant no requiere pago online" },
        { status: 400 },
      );
    }

    const { data: existingPayments, error: existingPaymentsError } =
      await supabaseAdmin
        .from("payments")
        .select("id, status, mp_preference_id")
        .eq("tenant_id", appointment.tenant_id)
        .eq("appointment_id", appointment.id);

    if (existingPaymentsError) {
      console.error("[payments/create] error leyendo payments:", existingPaymentsError);
      return NextResponse.json(
        { ok: false, error: "No se pudo validar el estado de pago actual" },
        { status: 500 },
      );
    }

    const paidPayment = (existingPayments ?? []).find(
      (payment) => String(payment.status ?? "").toLowerCase() === "paid",
    );

    if (paidPayment) {
      return NextResponse.json(
        { ok: false, error: "La cita ya tiene un pago aprobado" },
        { status: 409 },
      );
    }

    const appUrl =
      String(tenant?.base_url ?? "").trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      new URL(req.url).origin;

    const notificationUrl =
      providerId === "mercadopago"
        ? new URL(
            process.env.MERCADOPAGO_WEBHOOK_URL?.trim() ||
              `${appUrl}/api/webhooks/mercadopago`,
          )
        : new URL(`${appUrl}/api/webhooks/${providerId}`);
    notificationUrl.searchParams.set("tenantId", appointment.tenant_id);
    notificationUrl.searchParams.set("appointmentId", appointment.id);

    const successUrl =
      providerId === "webpay"
        ? `${appUrl}/api/payments/webpay/return?tenantId=${appointment.tenant_id}&appointmentId=${appointment.id}`
        : `${appUrl}/reservar/resultado?status=success`;

    const provider = getPaymentProvider(providerId);
    // TODO(manual): when an admin validation route marks a manual transfer as
    // paid, call notifyPaymentConfirmed after the pending -> paid transition.
    const payment = await provider.createPayment({
      appointmentId: appointment.id,
      tenantId: appointment.tenant_id,
      title: appointment.service_name || service.name || "Reserva",
      amount: breakdown.requiredOnlineAmount,
      currency: String(service.currency ?? "CLP").trim().toUpperCase() || "CLP",
      customerName: appointment.customer_name ?? null,
      customerEmail: appointment.customer_email ?? null,
      successUrl,
      failureUrl: `${appUrl}/reservar/resultado?status=failure`,
      pendingUrl: `${appUrl}/reservar/resultado?status=pending&id=${appointment.id}&provider=${providerId}`,
      notificationUrl: notificationUrl.toString(),
      config: providerConfig,
    });

    const latestPayment = (existingPayments ?? [])[0] ?? null;

    if (latestPayment?.id) {
      const { error: updateError } = await supabaseAdmin
        .from("payments")
        .update({
          mp_preference_id: payment.reference,
          external_reference: appointment.id,
          amount: breakdown.requiredOnlineAmount,
          status: "pending",
        })
        .eq("id", latestPayment.id)
        .eq("tenant_id", appointment.tenant_id);

      if (updateError) {
        console.error("[payments/create] error actualizando payment:", updateError);
        return NextResponse.json(
          { ok: false, error: "No se pudo persistir el pago" },
          { status: 500 },
        );
      }
    } else {
      const { error: insertError } = await supabaseAdmin.from("payments").insert({
        tenant_id: appointment.tenant_id,
        appointment_id: appointment.id,
        mp_preference_id: payment.reference,
        external_reference: appointment.id,
        amount: breakdown.requiredOnlineAmount,
        status: "pending",
      });

      if (insertError) {
        console.error("[payments/create] error insertando payment:", insertError);
        return NextResponse.json(
          { ok: false, error: "No se pudo guardar el pago pendiente" },
          { status: 500 },
        );
      }
    }

    const { error: appointmentUpdateError } = await supabaseAdmin
      .from("appointments")
      .update({
        payment_required: true,
        payment_status: "pending",
        status: "pending_payment",
        booking_status: "pending_payment",
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointment.id)
      .eq("tenant_id", appointment.tenant_id);

    if (appointmentUpdateError) {
      console.error("[payments/create] error actualizando appointment:", appointmentUpdateError);
      return NextResponse.json(
        { ok: false, error: "No se pudo actualizar la cita al iniciar el pago" },
        { status: 500 },
      );
    }

    await supabaseAdmin
      .from("appointments")
      .update({
        payment_provider: providerId,
        payment_required_amount: breakdown.requiredOnlineAmount,
        payment_remaining_amount: breakdown.remainingAmount,
        payment_reference: payment.reference,
        payment_url: payment.paymentUrl,
      })
      .eq("id", appointment.id)
      .eq("tenant_id", appointment.tenant_id);

    return NextResponse.json({
      ok: true,
      provider: providerId,
      payment_url: payment.paymentUrl,
      init_point: payment.paymentUrl,
      preference_id: payment.reference,
      reference: payment.reference,
      redirect_method: payment.redirectMethod ?? "GET",
      redirect_payload: payment.redirectPayload ?? null,
      amount: breakdown.requiredOnlineAmount,
      totalAmount: breakdown.totalAmount,
      remainingAmount: breakdown.remainingAmount,
      paymentMode: breakdown.paymentMode,
    });
  } catch (error) {
    console.error("[payments/create] unexpected error:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno creando pago" },
      { status: 500 },
    );
  }
}
