import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { fetchMercadoPagoPayment } from "@/services/payments/mercadopago";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
import { safePaymentAuditMetadata } from "@/lib/security/payment-verification.mjs";

function reject(status = 400) {
  return NextResponse.json({ ok: false, error: "Notificación inválida" }, { status });
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const intentId = String(url.searchParams.get("intent") ?? "").trim();
    const body = await req.json().catch(() => null);
    const paymentId = String(body?.data?.id ?? "").trim();
    if (!isUuid(intentId) || !/^\d{1,32}$/.test(paymentId)) return reject();

    const { data: intent, error: intentError } = await supabaseAdmin
      .from("payment_intents")
      .select("id, tenant_id, appointment_id, provider, provider_payment_id, amount, currency, status")
      .eq("id", intentId)
      .eq("provider", "mercadopago")
      .maybeSingle();
    if (intentError || !intent) return reject(404);
    if (intent.status === "succeeded") return NextResponse.json({ ok: true, replay: true });

    const config = await getTenantPaymentConfig(intent.tenant_id);
    if (!config.accessToken) return reject(503);
    const payment = await fetchMercadoPagoPayment({
      accessToken: config.accessToken,
      paymentId,
    });
    const amountMatches = Math.abs(Number(payment.transaction_amount) - Number(intent.amount)) < 0.0001;
    const currencyMatches = String(payment.currency_id ?? "").toUpperCase() === String(intent.currency).toUpperCase();
    const referenceMatches = String(payment.external_reference ?? "") === intent.id;
    const approved = String(payment.status ?? "").toLowerCase() === "approved";
    if (!amountMatches || !currencyMatches || !referenceMatches || !approved) {
      console.warn("[webhooks/mercadopago] verification rejected", { paymentIntentId: intent.id });
      return reject(409);
    }

    const { data: transitioned, error: finalizeError } = await supabaseAdmin.rpc(
      "finalize_verified_payment",
      {
        p_intent_id: intent.id,
        p_provider: "mercadopago",
        p_provider_payment_id: intent.provider_payment_id,
        p_audit_metadata: safePaymentAuditMetadata("mercadopago", payment),
      },
    );
    if (finalizeError) return reject(500);
    if (transitioned === true) {
      await notifyPaymentConfirmed({
        appointmentId: intent.appointment_id,
        provider: "mercadopago",
        externalPaymentId: paymentId,
      });
    }
    return NextResponse.json({ ok: true, replay: transitioned !== true });
  } catch (error) {
    console.error("[webhooks/mercadopago] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return reject(400);
  }
}
