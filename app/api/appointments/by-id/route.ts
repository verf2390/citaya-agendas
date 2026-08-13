import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid } from "@/lib/api/validators";
import { authorizeAppointmentActor } from "@/lib/api/appointmentAccess";

function notFound() {
  return NextResponse.json({ ok: false, error: "Cita no disponible" }, { status: 404 });
}

export async function GET(req: Request) {
  try {
    const id = String(new URL(req.url).searchParams.get("id") ?? "").trim();
    if (!isUuid(id)) return notFound();
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .select(`
        id, tenant_id, professional_id, service_id, service_name,
        customer_name, customer_phone, customer_email,
        start_at, end_at, status, booking_status, payment_status,
        manage_token, manage_token_hash, manage_token_expires_at,
        manage_token_revoked_at, manage_token_legacy_expires_at,
        professional:professionals(id, name),
        tenant:tenants!appointments_tenant_id_fkey(id, name, slug, logo_url, address, city, phone_display,
          show_address_after_booking, show_phone_after_booking)
      `)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return notFound();

    const access = await authorizeAppointmentActor({ req, appointment: data });
    if (!access.ok) return notFound();
    const common = {
      id: data.id,
      tenant_id: data.tenant_id,
      professional_id: data.professional_id,
      service_id: data.service_id,
      service_name: data.service_name,
      start_at: data.start_at,
      end_at: data.end_at,
      status: data.status,
      booking_status: data.booking_status,
      payment_status: data.payment_status,
      professional_name: (data.professional as { name?: string } | null)?.name ?? null,
      tenant: data.tenant,
    };
    const appointment =
      access.actor === "admin"
        ? {
            ...common,
            customer_name: data.customer_name,
            customer_phone: data.customer_phone,
            customer_email: data.customer_email,
          }
        : common;
    return NextResponse.json({ ok: true, appointment });
  } catch {
    return notFound();
  }
}
