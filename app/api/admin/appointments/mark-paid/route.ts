import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
export async function POST(req: Request) {
  try {
    const input = await req.json().catch(() => null);
    const appointmentId = String(input?.appointmentId ?? "").trim();
    if (!isUuid(appointmentId)) {
      return NextResponse.json({ ok: false, error: "appointmentId inválido" }, { status: 400 });
    }

    const access = await requireHostTenantAdmin(req);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }

    const { data: paymentIntentId, error } = await supabaseAdmin.rpc(
      "billing_record_manual_verified_payment",
      {
        p_tenant_id: access.tenantId,
        p_appointment_id: appointmentId,
        p_actor_id: access.userId,
      },
    );
    if (error) {
      console.error("[admin/appointments/mark-paid] atomic update failed", { code: error.code ?? null });
      return NextResponse.json({ ok: false, error: "No se pudo marcar la cita como pagada" }, { status: 500 });
    }

    await notifyPaymentConfirmed({
      appointmentId,
      provider: "manual",
      externalPaymentId: `manual:${appointmentId}`,
    });

    return NextResponse.json({
      ok: true,
      appointmentId,
      payment_status: "paid",
      paymentIntentId,
    });
  } catch (error) {
    console.error("[admin/appointments/mark-paid] unexpected error", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ ok: false, error: "Error marcando la cita como pagada" }, { status: 500 });
  }
}
