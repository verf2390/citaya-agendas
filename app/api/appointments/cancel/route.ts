import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifyWaitlistSlotReleased } from "@/services/automations/notify-waitlist-slot-released";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = String(body?.token ?? "").trim();

    if (!token || token.length < 20) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
    }

    const { data: currentAppointment, error: currentAppointmentError } =
      await supabaseAdmin
        .from("appointments")
        .select("id, tenant_id, customer_email, canceled_at, status, booking_status, service_id, start_at")
        .eq("manage_token", token)
        .maybeSingle();

    if (currentAppointmentError) {
      console.error("[cancel] lookup error:", currentAppointmentError);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!currentAppointment) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 404 });
    }

    if (String(currentAppointment.status ?? "").toLowerCase() === "canceled") {
      return NextResponse.json({
        ok: true,
        appointment: currentAppointment,
        n8n: {
          called: false,
          ok: true,
          result: { ok: true, skipped: "already_canceled" },
        },
      });
    }

    // 1) Cancelar en DB (y guardar timestamp)
    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({
        status: "canceled",
        booking_status: "cancelled",
        canceled_at: nowIso,
      })
      .eq("manage_token", token)
      .select("id, tenant_id, customer_email, canceled_at, status, booking_status, service_id, start_at")
      .maybeSingle();

    if (error) {
      console.error("[cancel] DB error:", error);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 404 });
    }

    if (currentAppointment.booking_status === "confirmed") {
      await notifyWaitlistSlotReleased({
        tenantId: currentAppointment.tenant_id,
        serviceId: currentAppointment.service_id,
        startAt: currentAppointment.start_at,
      });
    }

    // 2) Llamar a n8n para enviar correo + escribir notifications_log
    const n8nUrl = process.env.N8N_CANCEL_WEBHOOK_URL || "https://n8n.citaya.online/webhook/citaya-cancelacion";
    const secret = process.env.CITAYA_SECRET;

    let n8nResult: any = null;
    let n8nOk = false;

    if (!secret) {
      console.warn("[cancel] Missing CITAYA_SECRET env var. Skipping n8n call.");
    } else {
      try {
        const r = await fetch(n8nUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-citaya-secret": secret,
          },
          body: JSON.stringify({
            appointment_id: data.id,
            reason: "user_action",
            source: "manage_url",
          }),
        });

        // n8n siempre debería responder json
        n8nOk = r.ok;
        n8nResult = await r.json().catch(() => ({ ok: r.ok }));
      } catch (err: any) {
        console.error("[cancel] n8n call failed:", err?.message || err);
        n8nOk = false;
        n8nResult = { ok: false, error: err?.message || "n8n fetch failed" };
      }
    }

    // 3) Respuesta
    return NextResponse.json({
      ok: true,
      appointment: data,
      n8n: {
        called: !!secret,
        ok: n8nOk,
        result: n8nResult,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
