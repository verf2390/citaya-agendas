import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { WhatsAppWebhookEvent } from "@/lib/whatsapp/types";

if (typeof window !== "undefined") {
  throw new Error("WhatsApp repository is server-only");
}

export type ResolvedWhatsAppTenant = {
  tenantId: string;
  phoneNumberId: string;
  wabaId: string | null;
};

export async function resolveWhatsAppTenantByPhoneNumberId(
  phoneNumberId: string,
): Promise<ResolvedWhatsAppTenant | null> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_tenant_settings")
    .select("tenant_id,phone_number_id,waba_id,enabled,readiness_status")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();

  if (error) throw error;
  if (
    !data ||
    data.enabled !== true ||
    data.readiness_status !== "ready" ||
    data.phone_number_id !== phoneNumberId
  ) {
    return null;
  }

  return {
    tenantId: String(data.tenant_id),
    phoneNumberId: String(data.phone_number_id),
    wabaId: data.waba_id ? String(data.waba_id) : null,
  };
}

export async function recordWhatsAppWebhookEvent(input: {
  tenantId: string;
  event: WhatsAppWebhookEvent;
}) {
  const { error } = await supabaseAdmin
    .from("whatsapp_webhook_events")
    .upsert(
      {
        tenant_id: input.tenantId,
        event_key: input.event.eventKey,
        phone_number_id: input.event.phoneNumberId,
        provider_message_id: input.event.providerMessageId,
        direction: input.event.direction,
        event_type: input.event.eventType,
        occurred_at: input.event.occurredAt,
      },
      {
        onConflict: "tenant_id,event_key",
        ignoreDuplicates: true,
      },
    );

  if (error) throw error;
}
