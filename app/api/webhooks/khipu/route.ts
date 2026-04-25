import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";

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
