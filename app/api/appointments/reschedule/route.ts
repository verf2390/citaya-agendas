import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  generateManageToken,
  hashManageToken,
  manageTokenExpiresAt,
} from "@/lib/security/manage-tokens.mjs";
import { authorizeAppointmentActor } from "@/lib/api/appointmentAccess";
import { consumeRateLimit, opaqueKey, requestIp } from "@/lib/security/request";
import { notifyWaitlistSlotReleased } from "@/services/automations/notify-waitlist-slot-released";

function denied(status = 404) {
  return NextResponse.json({ ok: false, error: "No se pudo reagendar" }, { status });
}

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = new Map([["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6]]).get(value("weekday"));
  return { day, time: `${value("hour")}:${value("minute")}:00` };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = String(body?.token ?? "").trim();
    const start = new Date(String(body?.start_at ?? ""));
    const pepper = process.env.CITAYA_MANAGE_TOKEN_PEPPER?.trim();
    if (!pepper || token.length < 32 || token.length > 256 || Number.isNaN(start.getTime())) {
      return denied();
    }
    if (start.getTime() < Date.now() || start.getTime() > Date.now() + 365 * 86400_000) {
      return denied(400);
    }
    const columns = "id, tenant_id, professional_id, service_id, start_at, end_at, status, booking_status, reschedule_count, manage_token, manage_token_hash, manage_token_expires_at, manage_token_revoked_at, manage_token_legacy_expires_at";
    let result = await supabaseAdmin.from("appointments").select(columns)
      .eq("manage_token_hash", hashManageToken(token, pepper)).maybeSingle();
    if (!result.data && !result.error) {
      result = await supabaseAdmin.from("appointments").select(columns)
        .eq("manage_token", token)
        .gt("manage_token_legacy_expires_at", new Date().toISOString()).maybeSingle();
    }
    if (result.error || !result.data) return denied();
    const appointment = result.data;
    const access = await authorizeAppointmentActor({ req, appointment, manageToken: token });
    if (!access.ok || access.actor !== "manage_token") return denied();
    if (["canceled", "cancelled"].includes(String(appointment.status).toLowerCase())) return denied(409);
    if (Number(appointment.reschedule_count ?? 0) >= 2) return denied(409);

    const rateAllowed = await consumeRateLimit({
      scope: "appointment_reschedule",
      key: opaqueKey(requestIp(req), appointment.tenant_id, appointment.id),
      limit: 5,
      windowSeconds: 3600,
    });
    if (!rateAllowed) return denied(429);

    const { data: service, error: serviceError } = await supabaseAdmin.from("services")
      .select("id, duration_min, is_active")
      .eq("id", appointment.service_id)
      .eq("tenant_id", appointment.tenant_id)
      .eq("is_active", true).maybeSingle();
    const duration = Number(service?.duration_min);
    if (serviceError || !service || !Number.isInteger(duration) || duration < 5 || duration > 480) return denied(409);
    const end = new Date(start.getTime() + duration * 60_000);
    const startLocal = localParts(start);
    const endLocal = localParts(end);
    if (startLocal.day !== endLocal.day) return denied(409);
    const { data: available, error: availabilityError } = await supabaseAdmin.from("availability")
      .select("id")
      .eq("tenant_id", appointment.tenant_id)
      .eq("professional_id", appointment.professional_id)
      .eq("day_of_week", startLocal.day)
      .eq("is_active", true)
      .lte("start_time", startLocal.time)
      .gte("end_time", endLocal.time)
      .limit(1);
    if (availabilityError || !available?.length) return denied(409);

    const nextToken = generateManageToken();
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin.from("appointments")
      .update({
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        rescheduled_at: now,
        reschedule_count: Number(appointment.reschedule_count ?? 0) + 1,
        manage_token: null,
        manage_token_hash: hashManageToken(nextToken, pepper),
        manage_token_expires_at: manageTokenExpiresAt(),
        manage_token_revoked_at: null,
        manage_token_rotated_at: now,
        manage_token_legacy_expires_at: null,
      })
      .eq("id", appointment.id)
      .neq("status", "canceled")
      .select("id, start_at, end_at, status")
      .maybeSingle();
    if (updateError || !updated) return denied(updateError?.code === "23P01" ? 409 : 500);
    if (appointment.booking_status === "confirmed" && appointment.start_at !== updated.start_at) {
      await notifyWaitlistSlotReleased({
        tenantId: appointment.tenant_id,
        serviceId: appointment.service_id,
        startAt: appointment.start_at,
      });
    }
    return NextResponse.json({ ok: true, appointment: updated, manageToken: nextToken });
  } catch {
    return denied();
  }
}
