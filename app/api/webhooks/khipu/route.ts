import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
import { notifyWaitlistSlotReleased } from "@/services/automations/notify-waitlist-slot-released";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
    const appointmentId = String(url.searchParams.get("appointmentId") ?? "").trim();
    const body = await req.json().catch(() => null);

    if (!tenantId || !isUuid(tenantId) || !appointmentId || !isUuid(appointmentId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId/appointmentId inválido" },
        { status: 400 },
      );
    }

    const rawStatus = String(body?.status ?? body?.notification_type ?? "").toLowerCase();
    const paymentStatus =
      rawStatus.includes("done") ||
      rawStatus.includes("paid") ||
      rawStatus.includes("confirmed")
        ? "paid"
        : rawStatus.includes("fail") || rawStatus.includes("cancel")
          ? "failed"
          : "pending";
    const appointmentStatus =
      paymentStatus === "paid" ? "confirmed" : "pending_payment";
    const [{ data: currentAppointment }, { data: existingPayments }] =
      await Promise.all([
        supabaseAdmin
          .from("appointments")
          .select("payment_status, booking_status, service_id, start_at")
          .eq("id", appointmentId)
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabaseAdmin
          .from("payments")
          .select("status")
          .eq("tenant_id", tenantId)
          .eq("appointment_id", appointmentId)
          .limit(1),
      ]);
    const previousAppointmentPaymentStatus = String(
      currentAppointment?.payment_status ?? "",
    ).toLowerCase();
    const previousPaymentStatus = String(
      existingPayments?.[0]?.status ?? "",
    ).toLowerCase();

    await supabaseAdmin
      .from("payments")
      .update({ status: paymentStatus })
      .eq("tenant_id", tenantId)
      .eq("appointment_id", appointmentId);

    await supabaseAdmin
      .from("appointments")
      .update({
        payment_status: paymentStatus,
        status: appointmentStatus,
        booking_status: appointmentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointmentId)
      .eq("tenant_id", tenantId);

    if (paymentStatus === "paid") {
      await supabaseAdmin
        .from("appointments")
        .update({
          payment_paid_amount: Number(body?.amount ?? 0),
        })
        .eq("id", appointmentId)
        .eq("tenant_id", tenantId);

      if (
        previousAppointmentPaymentStatus !== "paid" &&
        previousPaymentStatus !== "paid"
      ) {
        await notifyPaymentConfirmed({
          appointmentId,
          provider: "khipu",
          externalPaymentId:
            body?.payment_id ?? body?.notification_id ?? body?.id ?? null,
        });
      } else {
        console.info("[webhooks/khipu] notificación paid omitida", {
          appointmentId,
          reason: "already_paid",
        });
      }
    } else if (currentAppointment?.booking_status === "confirmed") {
      await notifyWaitlistSlotReleased({
        tenantId,
        serviceId: currentAppointment.service_id ?? null,
        startAt: currentAppointment.start_at ?? null,
      });
    }

    return NextResponse.json({ ok: true, status: paymentStatus });
  } catch (error) {
    console.error("[webhooks/khipu] error:", error);
    return NextResponse.json(
      { ok: false, error: "Error procesando webhook Khipu" },
      { status: 500 },
    );
  }
}
