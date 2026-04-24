import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";
import { calculatePaymentAmount } from "@/services/payments/payment-amount";
import { createMercadoPagoPreference } from "@/services/payments/mercadopago";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const appointmentId = String(body?.appointmentId ?? "").trim();
    const tenantId = body?.tenantId ? String(body.tenantId).trim() : "";

    if (!appointmentId) {
      return NextResponse.json(
        { ok: false, error: "appointmentId requerido" },
        { status: 400 },
      );
    }

    if (!isUuid(appointmentId)) {
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

    if (!paymentConfig.enabled || paymentConfig.mode === 'none') {
      return NextResponse.json(
        { ok: false, error: "Pagos no habilitados para este tenant" },
        { status: 400 },
      );
    }

    if (!paymentConfig.accessToken) {
      return NextResponse.json(
        { ok: false, error: "Falta access token de Mercado Pago" },
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

    const servicePrice = service?.price ?? 0;

    const amount = calculatePaymentAmount({
      servicePrice,
      paymentMode: paymentConfig.mode,
      depositType: paymentConfig.depositType,
      depositValue: paymentConfig.depositValue,
    });

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Monto de pago inválido. Revisa price, payment_mode y configuración de abono.",
        },
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
      console.error(
        "[payments/create-preference] error leyendo payments:",
        existingPaymentsError,
      );
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

    const notificationUrl = new URL(
      process.env.MERCADOPAGO_WEBHOOK_URL?.trim() ||
        `${appUrl}/api/webhooks/mercadopago`,
    );
    notificationUrl.searchParams.set("tenantId", appointment.tenant_id);
    notificationUrl.searchParams.set("appointmentId", appointment.id);

    // La preferencia queda atada a la cita y tenant desde el backend para no
    // depender del frontend al momento de reconstruir el pago en el webhook.
    const preference = await createMercadoPagoPreference({
      accessToken: paymentConfig.accessToken,
      title: appointment.service_name || service.name || "Reserva",
      amount,
      currencyId: String(service.currency ?? "CLP").trim().toUpperCase() || "CLP",
      externalReference: appointment.id,
      payer: appointment.customer_email
        ? {
            email: appointment.customer_email,
            name: appointment.customer_name ?? undefined,
          }
        : undefined,
      successUrl: `${appUrl}/reservar/resultado?status=success`,
      failureUrl: `${appUrl}/reservar/resultado?status=failure`,
      pendingUrl: `${appUrl}/reservar/resultado?status=pending`,
      notificationUrl: notificationUrl.toString(),
    });

    const latestPayment = (existingPayments ?? [])[0] ?? null;

    if (latestPayment?.id) {
      const { error: updateError } = await supabaseAdmin
        .from("payments")
        .update({
          mp_preference_id: preference.id,
          external_reference: appointment.id,
          amount,
          status: "pending",
        })
        .eq("id", latestPayment.id)
        .eq("tenant_id", appointment.tenant_id);

      if (updateError) {
        console.error(
          "[payments/create-preference] error actualizando payment:",
          updateError,
        );
        return NextResponse.json(
          { ok: false, error: "No se pudo persistir la preferencia de pago" },
          { status: 500 },
        );
      }
    } else {
      const { error: insertError } = await supabaseAdmin.from("payments").insert({
        tenant_id: appointment.tenant_id,
        appointment_id: appointment.id,
        mp_preference_id: preference.id,
        external_reference: appointment.id,
        amount,
        status: "pending",
      });

      if (insertError) {
        console.error(
          "[payments/create-preference] error insertando payment:",
          insertError,
        );
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointment.id)
      .eq("tenant_id", appointment.tenant_id);

    if (appointmentUpdateError) {
      console.error(
        "[payments/create-preference] error actualizando appointment:",
        appointmentUpdateError,
      );
      return NextResponse.json(
        { ok: false, error: "No se pudo actualizar la cita al iniciar el pago" },
        { status: 500 },
      );
    }

    console.info("[payments/create-preference] preferencia creada", {
      appointmentId: appointment.id,
      tenantId: appointment.tenant_id,
      preferenceId: preference.id,
      amount,
    });

    return NextResponse.json({
      ok: true,
      init_point: preference.init_point,
      preference_id: preference.id,
      amount,
    });
  } catch (error) {
    console.error("[payments/create-preference] unexpected error:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno creando preferencia" },
      { status: 500 },
    );
  }
}
