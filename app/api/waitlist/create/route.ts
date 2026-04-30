import { NextResponse } from "next/server";
import { isUuid, isValidEmail } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function getHostnameFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function isValidIsoDateTime(value: string) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

async function resolveTenantId(req: Request, body: Record<string, unknown> | null) {
  const url = new URL(req.url);
  const tenantSlug =
    cleanText(body?.tenantSlug) ||
    cleanText(url.searchParams.get("tenantSlug")) ||
    cleanText(url.searchParams.get("tenant")) ||
    getTenantSlugFromHostname(getHostnameFromReq(req));

  if (tenantSlug) {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) return String(data.id);
  }

  // Backward compatibility: existing callers send tenantId.
  // Safety is enforced by validating service_id/professional_id ownership below.
  return cleanText(body?.tenantId);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const tenantId = await resolveTenantId(req, body);
    const serviceId = cleanText(body?.serviceId);
    const professionalId = cleanText(body?.professionalId);
    const date = cleanText(body?.date);
    const time = cleanText(body?.time);
    const desiredFromAt = cleanText(body?.desiredFromAt);
    const desiredToAt = cleanText(body?.desiredToAt);
    const customerName = cleanText(body?.customerName);
    const customerEmail = cleanText(body?.customerEmail).toLowerCase();
    const customerPhone = cleanText(body?.customerPhone);
    const notes = cleanText(body?.notes) || null;
    const source = cleanText(body?.source) || "booking_flow";

    if (!tenantId || !isUuid(tenantId)) {
      return NextResponse.json(
        { ok: false, error: "tenantId inválido" },
        { status: 400 },
      );
    }

    if (!serviceId || !isUuid(serviceId)) {
      return NextResponse.json(
        { ok: false, error: "serviceId inválido" },
        { status: 400 },
      );
    }

    if (!isValidDate(date) || !isValidTime(time)) {
      return NextResponse.json(
        { ok: false, error: "date/time inválidos" },
        { status: 400 },
      );
    }

    if (!customerName || !isValidEmail(customerEmail)) {
      return NextResponse.json(
        { ok: false, error: "Nombre y email válido son requeridos" },
        { status: 400 },
      );
    }

    if (professionalId && !isUuid(professionalId)) {
      return NextResponse.json(
        { ok: false, error: "professionalId inválido" },
        { status: 400 },
      );
    }

    if (desiredFromAt && !isValidIsoDateTime(desiredFromAt)) {
      return NextResponse.json(
        { ok: false, error: "desiredFromAt inválido" },
        { status: 400 },
      );
    }

    if (desiredToAt && !isValidIsoDateTime(desiredToAt)) {
      return NextResponse.json(
        { ok: false, error: "desiredToAt inválido" },
        { status: 400 },
      );
    }

    const { data: service, error: serviceError } = await supabaseAdmin
      .from("services")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", serviceId)
      .maybeSingle();

    if (serviceError) throw serviceError;
    if (!service) {
      return NextResponse.json(
        { ok: false, error: "serviceId no pertenece al tenant" },
        { status: 400 },
      );
    }

    if (professionalId) {
      const { data: professional, error: professionalError } =
        await supabaseAdmin
          .from("professionals")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("id", professionalId)
          .maybeSingle();

      if (professionalError) throw professionalError;
      if (!professional) {
        return NextResponse.json(
          { ok: false, error: "professionalId no pertenece al tenant" },
          { status: 400 },
        );
      }
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("waitlist_requests")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("service_id", serviceId)
      .eq("date", date)
      .eq("time", time)
      .eq("customer_email", customerEmail)
      .eq("status", "active")
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      return NextResponse.json({
        ok: true,
        waitlistRequestId: existing.id,
        duplicate: true,
      });
    }

    const { data: created, error: insertError } = await supabaseAdmin
      .from("waitlist_requests")
      .insert({
        tenant_id: tenantId,
        service_id: serviceId,
        professional_id: professionalId || null,
        date,
        time,
        desired_from_at: desiredFromAt
          ? new Date(desiredFromAt).toISOString()
          : null,
        desired_to_at: desiredToAt ? new Date(desiredToAt).toISOString() : null,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone || null,
        notes,
        source,
        status: "active",
      })
      .select("id")
      .single();

    if (
      insertError &&
      "code" in insertError &&
      insertError.code === "23505"
    ) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
      });
    }
    if (insertError) throw insertError;

    return NextResponse.json({
      ok: true,
      waitlistRequestId: created.id,
      duplicate: false,
    });
  } catch (error) {
    console.error("[waitlist/create] error:", error);
    return NextResponse.json(
      { ok: false, error: "Error registrando lista de espera" },
      { status: 500 },
    );
  }
}
