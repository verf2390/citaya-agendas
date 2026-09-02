import { supabaseAdmin } from "@/lib/supabaseAdmin";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function enqueueAutomaticDteBestEffort(
  paymentIntentId: string,
): Promise<void> {
  if (!UUID.test(paymentIntentId)) return;

  try {
    const payment = await supabaseAdmin
      .from("payment_intents")
      .select("id,tenant_id,appointment_id,provider,provider_payment_id,status")
      .eq("id", paymentIntentId)
      .maybeSingle();
    if (payment.error || !payment.data || payment.data.status !== "succeeded") return;

    const provider = String(payment.data.provider ?? "");
    const providerPaymentId = String(payment.data.provider_payment_id ?? "").trim();
    if (
      !["khipu", "webpay", "mercadopago"].includes(provider) ||
      !providerPaymentId ||
      providerPaymentId.length > 256
    ) {
      return;
    }

    const settings = await supabaseAdmin
      .from("dte_tenant_issuance_settings")
      .select("issuance_mode,production_enabled")
      .eq("tenant_id", payment.data.tenant_id)
      .maybeSingle();
    if (
      settings.error ||
      settings.data?.issuance_mode !== "automatic_on_verified_payment" ||
      settings.data?.production_enabled !== true
    ) {
      return;
    }

    const enqueued = await supabaseAdmin.rpc("dte_enqueue_payment_snapshot", {
      p_tenant_id: payment.data.tenant_id,
      p_appointment_id: payment.data.appointment_id,
      p_payment_intent_id: payment.data.id,
      p_payment_key: `${provider}:${providerPaymentId}`,
      p_trigger_source: provider,
      p_actor_id: null,
    });
    if (enqueued.error) {
      console.error("[payments/automatic-dte] enqueue failed", {
        paymentIntentId,
        code: enqueued.error.code ?? null,
      });
    }
  } catch (error) {
    console.error("[payments/automatic-dte] enqueue failed", {
      paymentIntentId,
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

