import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashManageToken } from "@/lib/security/manage-tokens.mjs";
import { authorizeAppointmentActor } from "@/lib/api/appointmentAccess";

function notFound() {
  return NextResponse.json({ ok: false, error: "Cita no disponible" }, { status: 404 });
}

export async function GET(req: Request) {
  try {
    const token = String(new URL(req.url).searchParams.get("token") ?? "").trim();
    if (token.length < 32 || token.length > 256) return notFound();
    const pepper = process.env.CITAYA_MANAGE_TOKEN_PEPPER?.trim();
    if (!pepper) return notFound();
    const columns = `id, tenant_id, professional_id, service_id, service_name,
      customer_name, customer_phone, customer_email,
      start_at, end_at, status, booking_status, payment_status,
      manage_token, manage_token_hash, manage_token_expires_at,
      manage_token_revoked_at, manage_token_legacy_expires_at,
      professional:professionals(id, name)`;
    let result = await supabaseAdmin
      .from("appointments")
      .select(columns)
      .eq("manage_token_hash", hashManageToken(token, pepper))
      .maybeSingle();
    if (!result.data && !result.error) {
      result = await supabaseAdmin
        .from("appointments")
        .select(columns)
        .eq("manage_token", token)
        .gt("manage_token_legacy_expires_at", new Date().toISOString())
        .maybeSingle();
    }
    if (result.error || !result.data) return notFound();
    const access = await authorizeAppointmentActor({
      req,
      appointment: result.data,
      manageToken: token,
    });
    if (!access.ok || access.actor !== "manage_token") return notFound();
    const data = result.data;
    return NextResponse.json({
      ok: true,
      appointment: {
        id: data.id,
        tenant_id: data.tenant_id,
        professional_id: data.professional_id,
        service_id: data.service_id,
        service_name: data.service_name,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        customer_email: data.customer_email,
        start_at: data.start_at,
        end_at: data.end_at,
        status: data.status,
        booking_status: data.booking_status,
        payment_status: data.payment_status,
        professional_name: (data.professional as { name?: string } | null)?.name ?? null,
      },
    });
  } catch {
    return notFound();
  }
}
