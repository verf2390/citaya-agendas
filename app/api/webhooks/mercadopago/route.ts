import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchMercadoPagoPayment,
} from "@/services/payments/mercadopago";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
import { notifyWaitlistSlotReleased } from "@/services/automations/notify-waitlist-slot-released";

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
  booking_status: string | null;
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
  switch (String(status ?? "").toLowerCase()) {
    case "approved":
      return "paid";
    case "rejected":
    case "cancelled":
    case "cancelled_by_user":
    case "expired":
    case "charged_back":
    case "refunded":
      return "failed";
    case "pending":
    case "in_process":
    default:
      return "pending";
  }
}

function appointmentStatusForPayment(paymentStatus: string) {
  return paymentStatus === "paid" ? "confirmed" : "pending_payment";
}

function bookingStatusForAppointmentStatus(appointmentStatus: string) {
  return appointmentStatus === "confirmed" ? "confirmed" : "pending_payment";
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
          "booking_status",
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
    console.log("[MP webhook] status mapped", {
      rawStatus: mpPayment.status,
      mappedStatus: normalizedStatus,
    });
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

      console.info("[webhooks/mercadopago] notificación paid omitida", {
        appointmentId: resolvedAppointmentId,
        reason: "already_processed",
        status: nextAppointmentStatus,
        payment_status: normalizedStatus,
      });

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
      normalizedStatus === "paid" &&
      appointmentRow.payment_status !== "paid" &&
      currentStatus !== "paid"
    ) {
      await notifyPaymentConfirmed({
        appointmentId: resolvedAppointmentId,
        provider: "mercadopago",
        externalPaymentId: paymentId,
      });
    } else if (
      normalizedStatus !== "paid" &&
      appointmentRow.booking_status === "confirmed"
    ) {
      await notifyWaitlistSlotReleased({
        tenantId,
        serviceId: appointmentRow.service_id,
        startAt: appointmentRow.start_at,
      });
    } else {
      console.info("[webhooks/mercadopago] notificación paid omitida", {
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
