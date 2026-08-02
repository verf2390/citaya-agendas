import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PaymentProviderId } from "@/services/payments/providers/types";

type NotifyPaymentConfirmedArgs = {
  appointmentId: string;
  provider: PaymentProviderId;
  externalPaymentId?: string | number | null;
};

type AppointmentRow = {
  id: string;
  tenant_id: string;
  professional_id: string | null;
  start_at: string | null;
  end_at: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  service_id: string | null;
  service_name: string | null;
  description: string | null;
  currency: string | null;
  status: string | null;
  booking_status: string | null;
  payment_required: boolean | null;
  payment_status: string | null;
  payment_provider: PaymentProviderId | null;
  payment_paid_amount: number | null;
  payment_required_amount: number | null;
  payment_remaining_amount: number | null;
  payment_reference: string | null;
  payment_url: string | null;
};

type TenantRow = {
  id: string;
  slug: string | null;
  name: string | null;
};

type ProfessionalRow = {
  id: string;
  name: string | null;
};

async function postToN8n(payload: Record<string, unknown>) {
  const webhookUrl = process.env.N8N_PAYMENT_CONFIRMED_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    console.warn(
      "N8N_PAYMENT_CONFIRMED_WEBHOOK_URL not configured; skipping payment confirmed notification",
    );
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[automations/payment-confirmed] n8n returned error", {
        status: res.status,
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyPaymentConfirmed(
  args: NotifyPaymentConfirmedArgs,
): Promise<void> {
  try {
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from("appointments")
      .select(
        [
          "id",
          "tenant_id",
          "professional_id",
          "start_at",
          "end_at",
          "customer_id",
          "customer_name",
          "customer_email",
          "customer_phone",
          "service_id",
          "service_name",
          "description",
          "currency",
          "status",
          "booking_status",
          "payment_required",
          "payment_status",
          "payment_provider",
          "payment_paid_amount",
          "payment_required_amount",
          "payment_remaining_amount",
          "payment_reference",
          "payment_url",
        ].join(","),
      )
      .eq("id", args.appointmentId)
      .maybeSingle();

    if (appointmentError) throw appointmentError;
    if (!appointment) {
      console.warn("[automations/payment-confirmed] appointment not found", {
        appointmentId: args.appointmentId,
        provider: args.provider,
      });
      return;
    }

    const appointmentRow = appointment as unknown as AppointmentRow;

    const [{ data: tenant }, { data: professional }] = await Promise.all([
      supabaseAdmin
        .from("tenants")
        .select("id, slug, name")
        .eq("id", appointmentRow.tenant_id)
        .maybeSingle(),
      appointmentRow.professional_id
        ? supabaseAdmin
            .from("professionals")
            .select("id, name")
            .eq("tenant_id", appointmentRow.tenant_id)
            .eq("id", appointmentRow.professional_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const tenantRow = (tenant ?? null) as TenantRow | null;
    const professionalRow = (professional ?? null) as ProfessionalRow | null;
    await postToN8n({
      source: "payment_confirmed",
      payment_status: appointmentRow.payment_status ?? "paid",
      payment_provider: appointmentRow.payment_provider ?? args.provider ?? null,
      payment_reference: appointmentRow.payment_reference ?? null,
      tenant_id: appointmentRow.tenant_id,
      tenant_slug: tenantRow?.slug ?? "",
      tenant_name: tenantRow?.name ?? "",
      appointment_id: appointmentRow.id,
      customer_id: appointmentRow.customer_id ?? null,
      customer_name: appointmentRow.customer_name ?? "",
      customer_email: appointmentRow.customer_email ?? "",
      customer_phone: appointmentRow.customer_phone ?? "",
      service_id: appointmentRow.service_id ?? null,
      service_name: "Servicio reservado",
      description: "",
      professional_id: appointmentRow.professional_id ?? null,
      staff_id: appointmentRow.professional_id ?? null,
      staff_name: professionalRow?.name ?? null,
      start_at: appointmentRow.start_at ?? null,
      end_at: appointmentRow.end_at ?? null,
      starts_at: appointmentRow.start_at ?? null,
      ends_at: appointmentRow.end_at ?? null,
      status: appointmentRow.status ?? "",
      booking_status: appointmentRow.booking_status ?? "",
      payment_required: appointmentRow.payment_required ?? false,
      payment_required_amount: appointmentRow.payment_required_amount ?? null,
      payment_paid_amount: appointmentRow.payment_paid_amount ?? null,
      payment_remaining_amount: appointmentRow.payment_remaining_amount ?? null,
      payment_url: appointmentRow.payment_url ?? null,
      amount_paid:
        appointmentRow.payment_paid_amount ??
        appointmentRow.payment_required_amount ??
        null,
      currency: appointmentRow.currency ?? "CLP",
      external_payment_id:
        args.externalPaymentId != null
          ? String(args.externalPaymentId)
          : appointmentRow.payment_reference,
    });
  } catch (error) {
    console.error("[automations/payment-confirmed] notification failed", {
      appointmentId: args.appointmentId,
      provider: args.provider,
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
