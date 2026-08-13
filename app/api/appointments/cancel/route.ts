import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashManageToken } from "@/lib/security/manage-tokens.mjs";
import { authorizeAppointmentActor } from "@/lib/api/appointmentAccess";
import { notifyWaitlistSlotReleased } from "@/services/automations/notify-waitlist-slot-released";
import {
  assertTenantCanCreateAppointment,
  assertTenantCanRunAppointmentOperationalEffects,
} from "@/lib/tenant/operational-server";
import { dispatchAppointmentCanceledEvent } from "@/services/automations/appointment-events.mjs";

function denied() {
  return NextResponse.json({ ok: false, error: "Cita no disponible" }, { status: 404 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = String(body?.token ?? "").trim();
    const pepper = process.env.CITAYA_MANAGE_TOKEN_PEPPER?.trim();
    if (!pepper || token.length < 32 || token.length > 256) return denied();
    const columns = "id, tenant_id, service_id, start_at, status, booking_status, manage_token, manage_token_hash, manage_token_expires_at, manage_token_revoked_at, manage_token_legacy_expires_at";
    let result = await supabaseAdmin.from("appointments").select(columns)
      .eq("manage_token_hash", hashManageToken(token, pepper)).maybeSingle();
    if (!result.data && !result.error) {
      result = await supabaseAdmin.from("appointments").select(columns)
        .eq("manage_token", token)
        .gt("manage_token_legacy_expires_at", new Date().toISOString()).maybeSingle();
    }
    if (result.error || !result.data) return denied();
    const appointment = result.data;
    try { await assertTenantCanCreateAppointment(appointment.tenant_id); } catch { return denied(); }
    const access = await authorizeAppointmentActor({ req, appointment, manageToken: token });
    if (!access.ok || access.actor !== "manage_token") return denied();
    if (["canceled", "cancelled"].includes(String(appointment.status).toLowerCase())) {
      return NextResponse.json({ ok: true, alreadyCanceled: true });
    }
    const now = new Date().toISOString();
    const { data: canceled, error } = await supabaseAdmin.from("appointments")
      .update({
        status: "canceled",
        booking_status: "cancelled",
        canceled_at: now,
        manage_token: null,
        manage_token_revoked_at: now,
        manage_token_legacy_expires_at: null,
      })
      .eq("id", appointment.id)
      .not("status", "in", '("canceled","cancelled")')
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: "No se pudo cancelar" }, { status: 409 });
    if (canceled && appointment.booking_status === "confirmed") {
      await notifyWaitlistSlotReleased({
        tenantId: appointment.tenant_id,
        serviceId: appointment.service_id,
        startAt: appointment.start_at,
      });
    }
    if (canceled) {
      try {
        await assertTenantCanRunAppointmentOperationalEffects(appointment.tenant_id);
        const notification = await dispatchAppointmentCanceledEvent({
          appointmentId: appointment.id,
          tenantId: appointment.tenant_id,
          source: "manage_token",
        });
        if (notification.called && !notification.ok) {
          console.warn("[appointments/cancel] appointment notification rejected", {
            status: notification.status,
            reason: notification.reason,
          });
        }
      } catch {
        // Cancellation remains successful when operational communication is unavailable.
      }
    }
    return NextResponse.json({ ok: true, alreadyCanceled: !canceled });
  } catch {
    return denied();
  }
}
