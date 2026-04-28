import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api/validators";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const tenantId = cleanText(body?.tenantId);
    const serviceId = cleanText(body?.serviceId);
    const date = cleanText(body?.date);
    const time = cleanText(body?.time);
    const customerName = cleanText(body?.customerName);
    const customerEmail = cleanText(body?.customerEmail).toLowerCase();
    const customerPhone = cleanText(body?.customerPhone);
    const notes = cleanText(body?.notes) || null;

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

    if (!customerName || !customerEmail) {
      return NextResponse.json(
        { ok: false, error: "customerName/customerEmail requeridos" },
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
        date,
        time,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone || null,
        notes,
        status: "active",
      })
      .select("id")
      .single();

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
