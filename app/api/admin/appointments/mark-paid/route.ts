import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
import {
  assertTenantCanCreatePayment,
  TenantOperationalError,
} from "@/lib/tenant/operational-server";
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
    await assertTenantCanCreatePayment(access.tenantId);

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

    const { data: appointment } = await supabaseAdmin.from("appointments")
      .select("payment_status,payment_remaining_amount")
      .eq("tenant_id", access.tenantId).eq("id", appointmentId).maybeSingle();

    return NextResponse.json({
      ok: true,
      appointmentId,
      payment_status: appointment?.payment_status ?? "partially_paid",
      payment_remaining_amount: appointment?.payment_remaining_amount ?? null,
      paymentIntentId,
    });
  } catch (error) {
    if (error instanceof TenantOperationalError) {
      return NextResponse.json({ ok: false, error: "La confirmación de pagos no está disponible para este entorno" }, { status: 409 });
    }
    console.error("[admin/appointments/mark-paid] unexpected error", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ ok: false, error: "Error marcando la cita como pagada" }, { status: 500 });
  }
}
