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
  currency: string | null;
  payment_paid_amount: number | null;
  payment_required_amount: number | null;
  payment_reference: string | null;
  manage_token: string | null;
};

type TenantRow = {
  id: string;
  slug: string | null;
  name: string | null;
  base_url: string | null;
};

type ProfessionalRow = {
  id: string;
  name: string | null;
};

function splitAppointmentDateTime(startAt: string | null) {
  if (!startAt) return { appointment_date: null, appointment_time: null };

  const [datePart, timePart = ""] = startAt.split("T");
  return {
    appointment_date: datePart || null,
    appointment_time: timePart.slice(0, 5) || null,
  };
}

function buildManageUrl(args: {
  baseUrl: string | null;
  manageToken: string | null;
}) {
  if (!args.baseUrl || !args.manageToken) return null;

  try {
    const url = new URL("/reservar/gestionar", args.baseUrl);
    url.searchParams.set("token", args.manageToken);
    return url.toString();
  } catch {
    return null;
  }
}

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
      const detail = await res.text().catch(() => "");
      console.error("[automations/payment-confirmed] n8n returned error", {
        status: res.status,
        detail,
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
          "currency",
          "payment_paid_amount",
          "payment_required_amount",
          "payment_reference",
          "manage_token",
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
        .select("id, slug, name, base_url")
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
    const baseUrl =
      String(tenantRow?.base_url ?? "").trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      null;
    const manageUrl = buildManageUrl({
      baseUrl,
      manageToken: appointmentRow.manage_token,
    });
    const { appointment_date, appointment_time } = splitAppointmentDateTime(
      appointmentRow.start_at,
    );

    await postToN8n({
      tenant_id: appointmentRow.tenant_id,
      tenant_slug: tenantRow?.slug ?? null,
      tenant_name: tenantRow?.name ?? null,
      appointment_id: appointmentRow.id,
      customer_id: appointmentRow.customer_id ?? null,
      customer_name: appointmentRow.customer_name ?? null,
      customer_email: appointmentRow.customer_email ?? null,
      customer_phone: appointmentRow.customer_phone ?? null,
      service_id: appointmentRow.service_id ?? null,
      service_name: appointmentRow.service_name ?? null,
      staff_id: appointmentRow.professional_id ?? null,
      staff_name: professionalRow?.name ?? null,
      appointment_date,
      appointment_time,
      starts_at: appointmentRow.start_at ?? null,
      ends_at: appointmentRow.end_at ?? null,
      amount_paid:
        appointmentRow.payment_paid_amount ??
        appointmentRow.payment_required_amount ??
        null,
      currency: appointmentRow.currency ?? "CLP",
      payment_provider: args.provider,
      payment_status: "paid",
      external_payment_id:
        args.externalPaymentId != null
          ? String(args.externalPaymentId)
          : appointmentRow.payment_reference,
      confirmation_token: appointmentRow.manage_token ?? null,
      manage_url: manageUrl,
      cancel_url: manageUrl,
      reschedule_url: manageUrl,
      source: "payment_confirmed",
    });
  } catch (error) {
    console.error("[automations/payment-confirmed] notification failed", {
      appointmentId: args.appointmentId,
      provider: args.provider,
      externalPaymentId: args.externalPaymentId ?? null,
      error,
    });
  }
}
