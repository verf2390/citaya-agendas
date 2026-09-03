import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { authorizeAppointmentActor } from "@/lib/api/appointmentAccess";
import { isUuid } from "@/lib/api/validators";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";
import { evaluateTenantPaymentReadiness } from "@/services/payments/provider-readiness";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function notFound() {
  return NextResponse.json(
    { ok: false, error: "Instrucciones de pago no disponibles" },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: Request) {
  try {
    const appointmentId = String(
      new URL(req.url).searchParams.get("appointmentId") ?? "",
    ).trim();
    if (!isUuid(appointmentId)) return notFound();

    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from("appointments")
      .select(
        "id,tenant_id,manage_token,manage_token_hash,manage_token_expires_at,manage_token_revoked_at,manage_token_legacy_expires_at",
      )
      .eq("id", appointmentId)
      .maybeSingle();
    if (appointmentError || !appointment) return notFound();

    const access = await authorizeAppointmentActor({ req, appointment });
    if (!access.ok) return notFound();

    const { data: manualIntent, error: intentError } = await supabaseAdmin
      .from("payment_intents")
      .select("id")
      .eq("tenant_id", appointment.tenant_id)
      .eq("appointment_id", appointment.id)
      .eq("provider", "manual")
      .in("status", ["pending", "processing", "succeeded"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (intentError || !manualIntent) return notFound();

    const paymentConfig = await getTenantPaymentConfig(appointment.tenant_id);
    const readiness = evaluateTenantPaymentReadiness(paymentConfig);
    if (!readiness.methods.manual.ready) return notFound();

    return NextResponse.json(
      {
        ok: true,
        instructions: {
          bankName: paymentConfig.bankName,
          bankAccountType: paymentConfig.bankAccountType,
          bankAccountNumber: paymentConfig.bankAccountNumber,
          bankAccountHolder: paymentConfig.bankAccountHolder,
          bankRut: paymentConfig.bankRut,
          bankEmail: paymentConfig.bankEmail,
        },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return notFound();
  }
}
