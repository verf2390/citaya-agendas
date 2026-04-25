import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchMercadoPagoPayment,
  mapMercadoPagoStatus,
} from "@/services/payments/mercadopago";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";

type MercadoPagoWebhookBody = {
  action?: string;
  type?: string;
  topic?: string;
  data?: {
    id?: string | number;
  };
};

type AppointmentWebhookRow = {
  id: string;
  tenant_id: string;
  professional_id: string | null;
  start_at: string | null;
  end_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_id: string | null;
  service_id: string | null;
  service_name: string | null;
  description: string | null;
  notes: string | null;
  currency: string | null;
  status: string | null;
  payment_required: boolean | null;
  payment_status: string | null;
  manage_token: string | null;
};

function getPaymentId(body: MercadoPagoWebhookBody): string {
  const paymentId = body?.data?.id;
  return typeof paymentId === "string" || typeof paymentId === "number"
    ? String(paymentId).trim()
    : "";
}

function mapWebhookPaymentStatus(status?: string | null) {
  if (String(status ?? "").toLowerCase() === "failed") {
    return "failed";
  }

  return mapMercadoPagoStatus(status);
}

function appointmentStatusForPayment(paymentStatus: string) {
  return paymentStatus === "paid" ? "confirmed" : "pending_payment";
}

function bookingStatusForAppointmentStatus(appointmentStatus: string) {
  return appointmentStatus === "confirmed" ? "confirmed" : "pending_payment";
}

function shouldSendConfirmation(args: {
  status: string | null;
  paymentRequired: boolean | null;
  paymentStatus: string | null;
}) {
  if (args.status !== "confirmed") return false;
  if (args.paymentRequired === true && args.paymentStatus !== "paid") return false;
  return true;
}

async function sendConfirmationWebhook(args: {
  appointmentId: string;
  tenantId: string;
  professionalId: string | null;
  startAt: string | null;
  endAt: string | null;
  customerName: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerId?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  description?: string | null;
  notes?: string | null;
  currency?: string | null;
  status: string;
  manageToken?: string | null;
}) {
  const webhookBase = process.env.N8N_CONFIRMATION_WEBHOOK_URL;
  const secret = process.env.CITAYA_SECRET;

  if (!webhookBase) {
    console.warn("[webhooks/mercadopago] N8N_CONFIRMATION_WEBHOOK_URL no seteada");
    return;
  }

  try {
    const url = new URL(webhookBase);
    if (secret) url.searchParams.set("secret", secret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "appointment.created",
        appointmentId: args.appointmentId,
        tenantId: args.tenantId,
        professionalId: args.professionalId,
        startAt: args.startAt,
        endAt: args.endAt,
        customerName: args.customerName,
        customerPhone: args.customerPhone ?? null,
        customerEmail: args.customerEmail ?? null,
        customerId: args.customerId ?? null,
        serviceId: args.serviceId ?? null,
        service_name: args.serviceName ?? null,
        description: args.description ?? null,
        notes: args.notes ?? null,
        currency: args.currency ?? "CLP",
        status: args.status,
        manage_token: args.manageToken ?? null,
        source: "citaya-api",
        createdAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (error) {
    console.error("[webhooks/mercadopago] n8n webhook error:", error);
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
    const appointmentId = String(url.searchParams.get("appointmentId") ?? "").trim();
    const body = (await req.json().catch(() => null)) as MercadoPagoWebhookBody | null;

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId inválido o ausente en webhook" },
        { status: 400 },
      );
    }

    if (!appointmentId || !isUuid(appointmentId)) {
      return NextResponse.json(
        { ok: false, error: "appointmentId inválido o ausente en webhook" },
        { status: 400 },
      );
    }

    const topic = String(body?.type ?? body?.topic ?? "").toLowerCase();
    const paymentId = getPaymentId(body ?? {});

    if (
      topic &&
      topic !== "payment" &&
      !String(body?.action ?? "").toLowerCase().startsWith("payment.")
    ) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `unsupported_topic:${topic}`,
      });
    }

    if (!paymentId) {
      console.info("[webhooks/mercadopago] webhook sin payment id", {
        tenantId,
        appointmentId,
        topic,
      });

      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "missing_payment_id",
      });
    }

    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from("appointments")
      .select(
        [
          "id",
          "tenant_id",
          "professional_id",
          "start_at",
          "end_at",
          "customer_name",
          "customer_phone",
          "customer_email",
          "customer_id",
          "service_id",
          "service_name",
          "description",
          "notes",
          "currency",
          "status",
          "payment_required",
          "payment_status",
          "manage_token",
        ].join(","),
      )
      .eq("id", appointmentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (appointmentError) {
      console.error(
        "[webhooks/mercadopago] error buscando cita:",
        appointmentError,
      );
      return NextResponse.json(
        { ok: false, error: "Error validando cita asociada al pago" },
        { status: 500 },
      );
    }

    if (!appointment) {
      return NextResponse.json(
        { ok: false, error: "Appointment no encontrada para webhook" },
        { status: 404 },
      );
    }

    const appointmentRow = appointment as unknown as AppointmentWebhookRow;

    const paymentConfig = await getTenantPaymentConfig(tenantId);
    if (!paymentConfig.accessToken) {
      return NextResponse.json(
        { ok: false, error: "Access token de Mercado Pago no configurado" },
        { status: 400 },
      );
    }

    const mpPayment = await fetchMercadoPagoPayment({
      accessToken: paymentConfig.accessToken,
      paymentId,
    });

    if (String(mpPayment.external_reference ?? "").trim() !== appointmentId) {
      console.warn("[webhooks/mercadopago] external_reference mismatch", {
        appointmentId,
        paymentId,
        externalReference: mpPayment.external_reference,
      });

      return NextResponse.json(
        { ok: false, error: "external_reference no coincide con la cita" },
        { status: 409 },
      );
    }

    const normalizedStatus = mapWebhookPaymentStatus(mpPayment.status);
    const { data: existingPayments, error: existingPaymentsError } =
      await supabaseAdmin
        .from("payments")
        .select("id, status, mp_preference_id, appointment_id, external_reference")
        .eq("tenant_id", tenantId)
        .eq("appointment_id", appointmentId);

    if (existingPaymentsError) {
      console.error(
        "[webhooks/mercadopago] error leyendo payments:",
        existingPaymentsError,
      );
      return NextResponse.json(
        { ok: false, error: "No se pudo leer el registro de pagos" },
        { status: 500 },
      );
    }

    const currentPayment = (existingPayments ?? [])[0] ?? null;
    const resolvedAppointmentId = String(
      currentPayment?.appointment_id ??
        currentPayment?.external_reference ??
        appointmentId,
    ).trim();

    if (!resolvedAppointmentId || !isUuid(resolvedAppointmentId)) {
      console.error("[webhooks/mercadopago] appointment id inválido", {
        appointmentId,
        resolvedAppointmentId,
        paymentId,
      });

      return NextResponse.json(
        { ok: false, error: "appointment_id inválido para sincronizar pago" },
        { status: 400 },
      );
    }

    const updateAppointmentPaymentStatus = async (paymentStatus: string) => {
      const nextAppointmentStatus = appointmentStatusForPayment(paymentStatus);
      const nextBookingStatus =
        bookingStatusForAppointmentStatus(nextAppointmentStatus);

      console.log("[webhook] updating appointment", {
        appointmentId: resolvedAppointmentId,
        status: nextAppointmentStatus,
        bookingStatus: nextBookingStatus,
        paymentStatus,
      });

      return supabaseAdmin
        .from("appointments")
        .update({
          status: nextAppointmentStatus,
          booking_status: nextBookingStatus,
          payment_status: paymentStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", resolvedAppointmentId)
        .eq("tenant_id", tenantId);
    };

    const currentStatus = String(currentPayment?.status ?? "").toLowerCase();
    const isDuplicateApproval =
      currentStatus === normalizedStatus &&
      normalizedStatus === "paid";

    if (isDuplicateApproval) {
      const nextAppointmentStatus = appointmentStatusForPayment(normalizedStatus);
      const { error: appointmentUpdateError } =
        await updateAppointmentPaymentStatus(normalizedStatus);

      if (appointmentUpdateError) {
        console.error(
          "[webhooks/mercadopago] error actualizando appointment payment_status:",
          appointmentUpdateError,
        );
        return NextResponse.json(
          { ok: false, error: "No se pudo actualizar payment_status de la cita" },
          { status: 500 },
        );
      }

      console.info("[webhooks/mercadopago] webhook duplicado omitido", {
        appointmentId: resolvedAppointmentId,
        paymentId,
        status: normalizedStatus,
      });

      const wasAlreadyConfirmedAndPaid =
        appointmentRow.status === "confirmed" &&
        appointmentRow.payment_status === "paid";
      const canSendConfirmation = shouldSendConfirmation({
        status: nextAppointmentStatus,
        paymentRequired: appointmentRow.payment_required ?? null,
        paymentStatus: normalizedStatus,
      });

      if (canSendConfirmation && !wasAlreadyConfirmedAndPaid) {
        await sendConfirmationWebhook({
          appointmentId: resolvedAppointmentId,
          tenantId,
          professionalId: appointmentRow.professional_id ?? null,
          startAt: appointmentRow.start_at ?? null,
          endAt: appointmentRow.end_at ?? null,
          customerName: appointmentRow.customer_name ?? null,
          customerPhone: appointmentRow.customer_phone ?? null,
          customerEmail: appointmentRow.customer_email ?? null,
          customerId: appointmentRow.customer_id ?? null,
          serviceId: appointmentRow.service_id ?? null,
          serviceName: appointmentRow.service_name ?? null,
          description: appointmentRow.description ?? null,
          notes: appointmentRow.notes ?? null,
          currency: appointmentRow.currency ?? "CLP",
          status: nextAppointmentStatus,
          manageToken: appointmentRow.manage_token ?? null,
        });
      } else {
        console.info("[webhooks/mercadopago] confirmación omitida", {
          appointmentId: resolvedAppointmentId,
          reason: wasAlreadyConfirmedAndPaid
            ? "already_confirmed_and_paid"
            : "payment_not_confirmed",
          status: nextAppointmentStatus,
          payment_required: appointmentRow.payment_required ?? null,
          payment_status: normalizedStatus,
        });
      }

      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already_processed",
        status: normalizedStatus,
      });
    }

    const payload = {
      status: normalizedStatus,
      external_reference: resolvedAppointmentId,
      mp_preference_id:
        String(currentPayment?.mp_preference_id ?? "").trim() || undefined,
    };

    if (currentPayment?.id) {
      const { error: updateError } = await supabaseAdmin
        .from("payments")
        .update(payload)
        .eq("id", currentPayment.id)
        .eq("tenant_id", tenantId);

      if (updateError) {
        console.error(
          "[webhooks/mercadopago] error actualizando payment:",
          updateError,
        );
        return NextResponse.json(
          { ok: false, error: "No se pudo actualizar el estado del pago" },
          { status: 500 },
        );
      }
    } else {
      const { error: insertError } = await supabaseAdmin.from("payments").insert({
        tenant_id: tenantId,
        appointment_id: resolvedAppointmentId,
        external_reference: resolvedAppointmentId,
        amount: mpPayment.transaction_amount ?? 0,
        status: normalizedStatus,
      });

      if (insertError) {
        console.error(
          "[webhooks/mercadopago] error insertando payment:",
          insertError,
        );
        return NextResponse.json(
          { ok: false, error: "No se pudo crear el registro de pago del webhook" },
          { status: 500 },
        );
      }
    }

    const nextAppointmentStatus = appointmentStatusForPayment(normalizedStatus);
    const { error: appointmentUpdateError } =
      await updateAppointmentPaymentStatus(normalizedStatus);

    if (appointmentUpdateError) {
      console.error(
        "[webhooks/mercadopago] error actualizando appointment payment_status:",
        appointmentUpdateError,
      );
      return NextResponse.json(
        { ok: false, error: "No se pudo actualizar payment_status de la cita" },
        { status: 500 },
      );
    }

    console.info("[webhooks/mercadopago] pago procesado", {
      topic,
      appointmentId: resolvedAppointmentId,
      tenantId,
      paymentId,
      status: normalizedStatus,
      rawStatus: mpPayment.status,
    });

    if (
      shouldSendConfirmation({
        status: nextAppointmentStatus,
        paymentRequired: appointmentRow.payment_required ?? null,
        paymentStatus: normalizedStatus,
      })
    ) {
      await sendConfirmationWebhook({
        appointmentId: resolvedAppointmentId,
        tenantId,
        professionalId: appointmentRow.professional_id ?? null,
        startAt: appointmentRow.start_at ?? null,
        endAt: appointmentRow.end_at ?? null,
        customerName: appointmentRow.customer_name ?? null,
        customerPhone: appointmentRow.customer_phone ?? null,
        customerEmail: appointmentRow.customer_email ?? null,
        customerId: appointmentRow.customer_id ?? null,
        serviceId: appointmentRow.service_id ?? null,
        serviceName: appointmentRow.service_name ?? null,
        description: appointmentRow.description ?? null,
        notes: appointmentRow.notes ?? null,
        currency: appointmentRow.currency ?? "CLP",
        status: nextAppointmentStatus,
        manageToken: appointmentRow.manage_token ?? null,
      });
    } else {
      console.info("[webhooks/mercadopago] confirmación omitida por pago pendiente", {
        appointmentId: resolvedAppointmentId,
        status: nextAppointmentStatus,
        payment_required: appointmentRow.payment_required ?? null,
        payment_status: normalizedStatus,
      });
    }

    return NextResponse.json({
      ok: true,
      appointmentId: resolvedAppointmentId,
      paymentId,
      status: normalizedStatus,
    });
  } catch (error) {
    console.error("[webhooks/mercadopago] unexpected error:", error);
    return NextResponse.json(
      { ok: false, error: "Error procesando webhook de Mercado Pago" },
      { status: 500 },
    );
  }
}
