import { NextResponse } from "next/server";
import { isUuid, isValidEmail } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import {
  consumeRateLimit,
  idempotencyKey,
  opaqueKey,
  requestIp,
} from "@/lib/security/request";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}
function fail(status = 400, error = "No se pudo registrar la solicitud") {
  return NextResponse.json({ ok: false, error }, { status });
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}
function validTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}
async function tenantFromRequest(req: Request, body: Record<string, unknown>) {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0].trim().split(":")[0];
  const slug = getTenantSlugFromHostname(host) || text(body.tenantSlug, 80);
  if (slug) {
    const { data } = await supabaseAdmin.from("tenants").select("id")
      .eq("slug", slug).maybeSingle();
    return String(data?.id ?? "");
  }
  return text(body.tenantId, 40);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail();
    const tenantId = await tenantFromRequest(req, body);
    const serviceId = text(body.serviceId, 40);
    const professionalId = text(body.professionalId, 40);
    const date = text(body.date, 10);
    const time = text(body.time, 5);
    const customerName = text(body.customerName, 120);
    const customerEmail = text(body.customerEmail, 254).toLowerCase();
    const customerPhone = text(body.customerPhone, 32);
    const notes = text(body.notes, 1000) || null;
    const desiredFrom = text(body.desiredFromAt, 64);
    const desiredTo = text(body.desiredToAt, 64);
    const key = idempotencyKey(req, body.idempotencyKey);
    if (
      !isUuid(tenantId) || !isUuid(serviceId) ||
      (professionalId && !isUuid(professionalId)) ||
      !validDate(date) || !validTime(time) || !customerName ||
      !isValidEmail(customerEmail) || !key
    ) return fail();
    const desiredFromDate = desiredFrom ? new Date(desiredFrom) : null;
    const desiredToDate = desiredTo ? new Date(desiredTo) : null;
    if (
      (desiredFromDate && Number.isNaN(desiredFromDate.getTime())) ||
      (desiredToDate && Number.isNaN(desiredToDate.getTime())) ||
      (desiredFromDate && desiredToDate && desiredFromDate >= desiredToDate)
    ) return fail();

    const allowed = await consumeRateLimit({
      scope: "waitlist_create",
      key: opaqueKey(requestIp(req), tenantId, customerEmail),
      limit: 8,
      windowSeconds: 3600,
    });
    if (!allowed) return fail(429, "Demasiadas solicitudes");

    const checks = [
      supabaseAdmin.from("services").select("id").eq("id", serviceId)
        .eq("tenant_id", tenantId).eq("is_active", true).maybeSingle(),
      professionalId
        ? supabaseAdmin.from("professionals").select("id").eq("id", professionalId)
            .eq("tenant_id", tenantId).eq("active", true).maybeSingle()
        : Promise.resolve({ data: { id: null }, error: null }),
    ];
    const [serviceResult, professionalResult] = await Promise.all(checks);
    if (serviceResult.error || !serviceResult.data || professionalResult.error || !professionalResult.data) {
      return fail(409);
    }

    const { data: existing } = await supabaseAdmin.from("waitlist_requests")
      .select("id").eq("tenant_id", tenantId).eq("idempotency_key", key).maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, waitlistRequestId: existing.id, duplicate: true });
    }
    const { data: created, error } = await supabaseAdmin.from("waitlist_requests").insert({
      tenant_id: tenantId,
      service_id: serviceId,
      professional_id: professionalId || null,
      date,
      time,
      desired_from_at: desiredFromDate?.toISOString() ?? null,
      desired_to_at: desiredToDate?.toISOString() ?? null,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      notes,
      source: "booking_flow",
      status: "active",
      idempotency_key: key,
    }).select("id").single();
    if (error?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    if (error || !created) return fail(500);
    return NextResponse.json({ ok: true, waitlistRequestId: created.id, duplicate: false });
  } catch (error) {
    console.error("[waitlist/create] failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return fail(500);
  }
}
