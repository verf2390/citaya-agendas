import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  safePaymentAuditMetadata,
  verifyKhipuPayment,
  verifyKhipuSignature,
} from "@/lib/security/payment-verification.mjs";
import { getKhipuCredentials } from "@/services/payments/provider-credentials";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
import {
  loadTenantOperationalContext,
  recordTenantOperationalRejection,
} from "@/lib/tenant/operational-server";

function reject(status = 400) {
  return NextResponse.json({ ok: false, error: "Notificación inválida" }, { status });
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    if (!rawBody || rawBody.length > 64 * 1024) return reject();
    const event = JSON.parse(rawBody);
    const paymentId = String(event?.payment_id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(paymentId)) return reject();

    const { data: intent, error: intentError } = await supabaseAdmin
      .from("payment_intents")
      .select("id, tenant_id, appointment_id, provider, provider_payment_id, amount, currency, status")
      .eq("provider", "khipu")
      .eq("provider_payment_id", paymentId)
      .maybeSingle();
    if (intentError || !intent) return reject(404);
    const operational = await loadTenantOperationalContext(intent.tenant_id);
    if (!operational.capabilities.acceptPaymentWebhook) {
      await recordTenantOperationalRejection({
        tenantId: intent.tenant_id, operation: "payment_webhook", source: "khipu",
        safeReference: intent.id, reasonCode: "TENANT_MODE_WEBHOOK_BLOCKED",
      });
      return NextResponse.json({ ok: true, ignored: true }, { status: 202 });
    }

    const credentials = getKhipuCredentials(intent.tenant_id);
    if (!credentials) return reject(503);
    if (
      !verifyKhipuSignature({
        rawBody,
        signatureHeader: req.headers.get("x-khipu-signature"),
        secret: credentials.apiKey,
      })
    ) {
      return reject(401);
    }

    if (intent.status === "succeeded") {
      return NextResponse.json({ ok: true, replay: true });
    }

    const response = await fetch(
      `https://payment-api.khipu.com/v3/payments/${encodeURIComponent(paymentId)}`,
      {
        method: "GET",
        headers: { "x-api-key": credentials.apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    const payment = await response.json().catch(() => null);
    if (!response.ok || !payment) return reject(502);

    const verified = verifyKhipuPayment(intent, payment, credentials.receiverId);
    if (!verified.ok) {
      if (verified.reason === "amount_mismatch") {
        await supabaseAdmin.rpc("billing_record_unapplied_provider_payment", {
          p_intent_id: intent.id,
          p_provider: "khipu",
          p_provider_payment_id: paymentId,
          p_received_amount: Number(payment.amount),
          p_audit_metadata: safePaymentAuditMetadata("khipu", payment),
        });
      }
      console.warn("[webhooks/khipu] verification rejected", {
        paymentIntentId: intent.id,
        reason: verified.reason,
      });
      return reject(409);
    }

    const { data: transitioned, error: finalizeError } = await supabaseAdmin.rpc(
      "finalize_verified_payment",
      {
        p_intent_id: intent.id,
        p_provider: "khipu",
        p_provider_payment_id: paymentId,
        p_audit_metadata: safePaymentAuditMetadata("khipu", payment),
      },
    );
    if (finalizeError) {
      console.error("[webhooks/khipu] atomic finalize failed", {
        paymentIntentId: intent.id,
        code: finalizeError.code ?? null,
      });
      return reject(500);
    }

    if (transitioned === true) {
      await notifyPaymentConfirmed({
        appointmentId: intent.appointment_id,
        provider: "khipu",
        externalPaymentId: paymentId,
      });
    }
    return NextResponse.json({ ok: true, replay: transitioned !== true });
  } catch (error) {
    console.error("[webhooks/khipu] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return reject(400);
  }
}
