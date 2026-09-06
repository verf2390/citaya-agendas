import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import { isUuid } from "@/lib/api/validators";
import {
  safePaymentAuditMetadata,
  verifyMercadoPagoPayment,
} from "@/lib/security/payment-verification.mjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  assertTenantCanVerifyProviderPayment,
  TenantOperationalError,
} from "@/lib/tenant/operational-server";
import { notifyPaymentConfirmed } from "@/services/automations/notify-payment-confirmed";
import { enqueueAutomaticDteBestEffort } from "@/services/payments/automatic-dte";
import { fetchMercadoPagoPayment } from "@/services/payments/mercadopago";
import { getTenantPaymentConfig } from "@/services/payments/payment-config";

const CONFIRMABLE_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "reconciliation_required",
];

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const access = await requireHostTenantAdmin(req);
    if (!access.ok) return jsonError(access.status, access.error);
    const operational = await assertTenantCanVerifyProviderPayment(access.tenantId);

    const input = await req.json().catch(() => null);
    const appointmentId = String(input?.appointmentId ?? "").trim();
    const paymentId = String(input?.paymentId ?? "").trim();
    if (!isUuid(appointmentId) || !/^\d{1,32}$/.test(paymentId)) {
      return jsonError(400, "Datos de pago inválidos");
    }

    const config = await getTenantPaymentConfig(access.tenantId);
    if (!config.accessToken) {
      return jsonError(409, "Mercado Pago no está configurado para este tenant");
    }

    const payment = await fetchMercadoPagoPayment({
      accessToken: config.accessToken,
      paymentId,
    });
    const externalReference = String(payment.external_reference ?? "").trim();
    if (!isUuid(externalReference)) {
      return jsonError(409, "Mercado Pago no informó una referencia válida");
    }
    const receivedAmount = Number(payment.transaction_amount);
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      return jsonError(409, "Mercado Pago no informó un monto válido");
    }

    const intentResult = await supabaseAdmin
      .from("payment_intents")
      .select(
        "id,tenant_id,appointment_id,provider,provider_payment_id,verified_provider_payment_id,amount,currency,status,audit_metadata",
      )
      .eq("id", externalReference)
      .eq("tenant_id", access.tenantId)
      .eq("appointment_id", appointmentId)
      .eq("provider", "mercadopago")
      .in("status", CONFIRMABLE_STATUSES)
      .maybeSingle();
    if (intentResult.error) return jsonError(500, "No se pudo revisar el pago");
    if (!intentResult.data) {
      return jsonError(409, "El pago de Mercado Pago no corresponde a esta cita");
    }

    const intent = intentResult.data;
    const preferenceId = String(intent.provider_payment_id ?? "").trim();
    if (!preferenceId) return jsonError(409, "El pago no tiene una referencia verificable");

    const verification = verifyMercadoPagoPayment(intent, payment, paymentId);
    const auditMetadata = {
      ...safePaymentAuditMetadata("mercadopago", payment),
      verification_source: "admin_mercadopago_lookup",
    };

    if (!verification.ok && verification.reason !== "amount_mismatch") {
      console.warn("[admin/payments/mercadopago/confirm] verification rejected", {
        paymentIntentId: intent.id,
        reason: verification.reason,
      });
      return jsonError(409, "Mercado Pago no confirmó los datos esperados");
    }

    const confirmation = await supabaseAdmin.rpc(
      "billing_confirm_manually_verified_mercadopago_payment",
      {
        p_tenant_id: access.tenantId,
        p_appointment_id: appointmentId,
        p_intent_id: intent.id,
        p_preference_id: preferenceId,
        p_mercadopago_payment_id: paymentId,
        p_received_amount: receivedAmount,
        p_actor_id: access.userId,
        p_audit_metadata: auditMetadata,
      },
    );
    if (confirmation.error) {
      console.error("[admin/payments/mercadopago/confirm] atomic confirmation failed", {
        code: confirmation.error.code ?? null,
      });
      const conflict = confirmation.error.code === "23505" ||
        /MISMATCH|NOT_PAYABLE|AMBIGUOUS/.test(confirmation.error.message ?? "");
      return jsonError(conflict ? 409 : 500, "No se pudo confirmar el pago verificado");
    }

    const outcome = String(confirmation.data ?? "");
    if (!["transitioned", "replay", "reconciliation_required"].includes(outcome)) {
      return jsonError(500, "Mercado Pago devolvió un resultado no verificable");
    }
    if (outcome === "reconciliation_required") {
      return jsonError(409, "El monto informado por Mercado Pago requiere conciliación");
    }

    await enqueueAutomaticDteBestEffort(intent.id);
    if (outcome === "transitioned" && operational.capabilities.sendExternalEmail) {
      await notifyPaymentConfirmed({
        appointmentId,
        provider: "mercadopago",
        externalPaymentId: paymentId,
      });
    }

    return NextResponse.json({
      ok: true,
      appointmentId,
      paymentIntentId: intent.id,
      replay: outcome === "replay",
    });
  } catch (error) {
    if (error instanceof TenantOperationalError) {
      return jsonError(409, "La verificación de pagos no está disponible para este entorno");
    }
    console.error("[admin/payments/mercadopago/confirm] unexpected error", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError(500, "No se pudo verificar el pago en Mercado Pago");
  }
}
