import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
import type { PaymentProviderId } from "@/services/payments/providers/types";

const PAYMENT_PROVIDERS: PaymentProviderId[] = [
  "mercadopago",
  "webpay",
  "khipu",
  "manual",
];

function normalizePaymentProvider(value: unknown): PaymentProviderId {
  const provider = String(value ?? "manual").trim().toLowerCase();
  return PAYMENT_PROVIDERS.includes(provider as PaymentProviderId)
    ? (provider as PaymentProviderId)
    : "manual";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const appointmentId = String(body?.appointmentId ?? "").trim();
    const paymentProvider = normalizePaymentProvider(body?.paymentProvider);

    if (!isUuid(appointmentId)) {
      return NextResponse.json(
        { ok: false, error: "appointmentId inválido" },
        { status: 400 },
      );
    }

    const { data: appointment, error: readError } = await supabaseAdmin
      .from("appointments")
      .select("id, payment_paid_amount, payment_required_amount")
      .eq("id", appointmentId)
      .maybeSingle();

    if (readError) {
      console.error("[admin/appointments/mark-paid] read error:", readError);
      return NextResponse.json(
        { ok: false, error: "No se pudo leer la cita" },
        { status: 500 },
      );
    }

    if (!appointment) {
      return NextResponse.json(
        { ok: false, error: "Cita no encontrada" },
        { status: 404 },
      );
    }

    const paymentPaidAmount =
      appointment.payment_required_amount ??
      appointment.payment_paid_amount ??
      0;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("appointments")
      .update({
        payment_status: "paid",
        payment_provider: paymentProvider,
        payment_paid_amount: paymentPaidAmount,
        booking_status: "confirmed",
        status: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointmentId)
      .select("id, payment_status")
      .maybeSingle();

    if (updateError) {
      console.error("[admin/appointments/mark-paid] update error:", updateError);
      return NextResponse.json(
        { ok: false, error: "No se pudo marcar la cita como pagada" },
        { status: 500 },
      );
    }

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Cita no encontrada" },
        { status: 404 },
      );
    }

    await notifyPaymentConfirmed({
      appointmentId,
      provider: paymentProvider,
      externalPaymentId: `manual:${appointmentId}`,
    });

    return NextResponse.json({
      ok: true,
      appointmentId,
      payment_status: "paid",
    });
  } catch (error) {
    console.error("[admin/appointments/mark-paid] unexpected error:", error);
    return NextResponse.json(
      { ok: false, error: "Error marcando la cita como pagada" },
      { status: 500 },
    );
  }
}
