import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  safePaymentAuditMetadata,
  verifyWebpayCommit,
} from "@/lib/security/payment-verification.mjs";
import {
  getWebpayCredentials,
  webpayTransaction,
} from "@/services/payments/provider-credentials";
import { enqueueAutomaticDteBestEffort } from "@/services/payments/automatic-dte";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
import {
  loadTenantOperationalContext,
  recordTenantOperationalRejection,
} from "@/lib/tenant/operational-server";

function redirectResult(req: Request, status: "success" | "failure", appointmentId?: string) {
  const url = new URL("/reservar/resultado", new URL(req.url).origin);
  url.searchParams.set("status", status);
  if (appointmentId) url.searchParams.set("id", appointmentId);
  return NextResponse.redirect(url);
}

async function tokenFromRequest(req: Request) {
  const url = new URL(req.url);
  const queryToken = String(url.searchParams.get("token_ws") ?? "").trim();
  if (queryToken) return queryToken;
  if (req.method !== "POST") return "";
  const form = await req.formData().catch(() => null);
  return String(form?.get("token_ws") ?? "").trim();
}

export async function GET(req: Request) {
  return handleWebpayReturn(req);
}
export async function POST(req: Request) {
  return handleWebpayReturn(req);
}

async function handleWebpayReturn(req: Request) {
  try {
    const token = await tokenFromRequest(req);
    if (!token || token.length > 256) return redirectResult(req, "failure");

    const { data: intent, error: intentError } = await supabaseAdmin
      .from("payment_intents")
      .select("id, tenant_id, appointment_id, provider, provider_payment_id, buy_order, session_id, amount, currency, status")
      .eq("provider", "webpay")
      .eq("provider_payment_id", token)
      .maybeSingle();
    if (intentError || !intent) return redirectResult(req, "failure");
    const operational = await loadTenantOperationalContext(intent.tenant_id);
    if (!operational.capabilities.acceptPaymentWebhook) {
      await recordTenantOperationalRejection({
        tenantId: intent.tenant_id, operation: "payment_webhook", source: "webpay_return",
        safeReference: intent.id, reasonCode: "TENANT_MODE_WEBHOOK_BLOCKED",
      });
      return redirectResult(req, "failure");
    }
    if (intent.status === "succeeded") {
      await enqueueAutomaticDteBestEffort(intent.id);
      return redirectResult(req, "success", intent.appointment_id);
    }
    if (intent.status !== "pending") return redirectResult(req, "failure");

    const credentials = getWebpayCredentials(intent.tenant_id);
    if (!credentials) return redirectResult(req, "failure");
    const transaction = await webpayTransaction(credentials).commit(token);
    const verified = verifyWebpayCommit(intent, transaction, token);
    if (!verified.ok) {
      if (verified.reason === "amount_mismatch") {
        await supabaseAdmin.rpc("billing_record_unapplied_provider_payment", {
          p_intent_id: intent.id,
          p_provider: "webpay",
          p_provider_payment_id: token,
          p_received_amount: Number(transaction.amount),
          p_audit_metadata: safePaymentAuditMetadata("webpay", transaction),
        });
      }
      console.warn("[payments/webpay/return] verification rejected", {
        paymentIntentId: intent.id,
        reason: verified.reason,
      });
      return redirectResult(req, "failure");
    }

    const { data: transitioned, error: finalizeError } = await supabaseAdmin.rpc(
      "finalize_verified_payment",
      {
        p_intent_id: intent.id,
        p_provider: "webpay",
        p_provider_payment_id: token,
        p_audit_metadata: safePaymentAuditMetadata("webpay", transaction),
      },
    );
    if (finalizeError) {
      console.error("[payments/webpay/return] atomic finalize failed", {
        paymentIntentId: intent.id,
        code: finalizeError.code ?? null,
      });
      return redirectResult(req, "failure");
    }
    await enqueueAutomaticDteBestEffort(intent.id);
    if (transitioned === true) {
      await notifyPaymentConfirmed({
        appointmentId: intent.appointment_id,
        provider: "webpay",
        externalPaymentId: token,
      });
    }
    return redirectResult(req, "success", intent.appointment_id);
  } catch (error) {
    console.error("[payments/webpay/return] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return redirectResult(req, "failure");
  }
}
