import { supabaseAdmin } from "@/lib/supabaseAdmin";

type NotifyWaitlistSlotReleasedArgs = {
  tenantId: string | null;
  serviceId: string | null;
  startAt: string | null;
  professionalId?: string | null;
};

type WaitlistRequestRow = {
  id: string;
  professional_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  desired_from_at: string | null;
  desired_to_at: string | null;
  created_at: string;
};

type TenantRow = {
  id: string;
  slug: string | null;
  name: string | null;
  public_base_url?: string | null;
  base_url?: string | null;
};

type ServiceRow = {
  id: string;
  name: string | null;
};

const MAX_WAITLIST_NOTIFICATIONS = 5;

function getSlotParts(startAt: string) {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;

  if (!day || !time) return null;
  return { date: day, time };
}

function normalizeTenantBaseUrl(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, "");
}

async function fetchTenantForBookingUrl(tenantId: string) {
  const withUrlColumns = await supabaseAdmin
    .from("tenants")
    .select("id, slug, name, public_base_url, base_url")
    .eq("id", tenantId)
    .maybeSingle();

  if (!withUrlColumns.error) return withUrlColumns.data as TenantRow | null;

  const fallback = await supabaseAdmin
    .from("tenants")
    .select("id, slug, name")
    .eq("id", tenantId)
    .maybeSingle();

  if (fallback.error) throw fallback.error;
  return fallback.data as TenantRow | null;
}

async function fetchServiceForPayload(tenantId: string, serviceId: string) {
  const { data, error } = await supabaseAdmin
    .from("services")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("id", serviceId)
    .maybeSingle();

  if (error) throw error;
  return data as ServiceRow | null;
}

function buildTenantBookingUrl(tenant: TenantRow, serviceId: string) {
  const tenantBaseUrl =
    normalizeTenantBaseUrl(tenant.public_base_url) ||
    normalizeTenantBaseUrl(tenant.base_url) ||
    (tenant.slug ? `https://${tenant.slug}.citaya.online` : "");

  if (!tenantBaseUrl) return null;

  return {
    tenantBaseUrl,
    bookingUrl: `${tenantBaseUrl}/reservar?service=${encodeURIComponent(serviceId)}`,
  };
}

export async function notifyWaitlistSlotReleased(
  args: NotifyWaitlistSlotReleasedArgs,
): Promise<void> {
  try {
    if (!args.tenantId || !args.serviceId || !args.startAt) return;

    const slot = getSlotParts(args.startAt);
    if (!slot) return;

    const releasedSlot = new Date(args.startAt);
    const { data, error } = await supabaseAdmin
      .from("waitlist_requests")
      .select(
        "id, professional_id, customer_email, customer_name, customer_phone, notes, desired_from_at, desired_to_at, created_at",
      )
      .eq("tenant_id", args.tenantId)
      .eq("service_id", args.serviceId)
      .eq("status", "active")
      .is("deleted_at", null)
      .or(
        [
          `and(date.eq.${slot.date},time.eq.${slot.time})`,
          `and(desired_from_at.lte.${releasedSlot.toISOString()},desired_to_at.gte.${releasedSlot.toISOString()})`,
        ].join(","),
      )
      .order("created_at", { ascending: true })
      .limit(MAX_WAITLIST_NOTIFICATIONS);

    if (error) throw error;

    const requests = (data ?? []) as WaitlistRequestRow[];
    if (requests.length === 0) return;

    const tenant = await fetchTenantForBookingUrl(args.tenantId);
    if (!tenant?.id) {
      console.error("[waitlist] tenant not found for booking url", {
        tenantId: args.tenantId,
        serviceId: args.serviceId,
      });
      return;
    }

    const service = await fetchServiceForPayload(args.tenantId, args.serviceId);
    const builtUrl = buildTenantBookingUrl(tenant, args.serviceId);
    if (!builtUrl) {
      console.error("[waitlist] could not build tenant booking url", {
        tenantId: args.tenantId,
        tenantSlug: tenant.slug,
        serviceId: args.serviceId,
      });
      return;
    }

    console.log("[waitlist] bookingUrl built", {
      tenantSlug: tenant.slug,
      tenantBaseUrl: builtUrl.tenantBaseUrl,
      serviceId: args.serviceId,
      bookingUrl: builtUrl.bookingUrl,
    });

    const webhookUrl = process.env.N8N_WAITLIST_SLOT_RELEASED_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log("[waitlist] slot released but webhook is not configured", {
        tenantId: args.tenantId,
        serviceId: args.serviceId,
        date: slot.date,
        time: slot.time,
        requestCount: requests.length,
      });
      return;
    }

    const professionalId =
      args.professionalId ?? requests.find((request) => request.professional_id)?.professional_id ?? null;
    const secret =
      process.env.N8N_WEBHOOK_SECRET || process.env.CITAYA_WEBHOOK_SECRET || "";
    const payload = {
      tenantId: args.tenantId,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      serviceId: args.serviceId,
      serviceName: service?.name ?? null,
      professionalId,
      date: slot.date,
      time: slot.time,
      releasedSlot: args.startAt,
      bookingUrl: builtUrl.bookingUrl,
      requests: requests.map((request) => ({
        id: request.id,
        professionalId: request.professional_id,
        name: request.customer_name,
        email: request.customer_email,
        phone: request.customer_phone,
        notes: request.notes,
        desiredFromAt: request.desired_from_at,
        desiredToAt: request.desired_to_at,
        createdAt: request.created_at,
      })),
    };

    console.log("[waitlist] slot released", {
      tenantId: args.tenantId,
      serviceId: args.serviceId,
      date: slot.date,
      time: slot.time,
      requestCount: requests.length,
      requestIds: requests.map((request) => request.id),
    });

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-citaya-secret": secret } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[waitlist] n8n webhook failed", {
        tenantId: args.tenantId,
        serviceId: args.serviceId,
        status: res.status,
        detail,
      });
      return;
    }

    const { error: updateError } = await supabaseAdmin
      .from("waitlist_requests")
      .update({ status: "notified", notified_at: new Date().toISOString() })
      .in(
        "id",
        requests.map((request) => request.id),
      );

    if (updateError) throw updateError;
  } catch (error) {
    console.error("[waitlist] failed to process released slot", {
      tenantId: args.tenantId,
      serviceId: args.serviceId,
      startAt: args.startAt,
      error,
    });
  }
}
