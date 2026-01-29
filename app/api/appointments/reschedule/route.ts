// app/api/appointments/reschedule/route.ts
// (Cliente - gestionar cita) -> reagendar por token + dispara n8n (multi-tenant)
// Regla: máximo 2 reagendados por cita

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const token = String(body?.token ?? "").trim();
    const start_at = String(body?.start_at ?? "").trim();
    const end_at = String(body?.end_at ?? "").trim();

    if (!token || !start_at || !end_at) {
      return NextResponse.json(
        { ok: false, error: "Missing token/start_at/end_at" },
        { status: 400 }
      );
    }

    // 1) Leer cita actual (ANTES)
    const { data: oldAppt, error: oldErr } = await supabaseAdmin
      .from("appointments")
      .select("*")
      .eq("manage_token", token)
      .maybeSingle();

    if (oldErr) {
      console.error("Old appointment lookup error:", oldErr);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!oldAppt) {
      return NextResponse.json(
        { ok: false, error: "Invalid token" },
        { status: 404 }
      );
    }

    // 2) Bloqueos de negocio
    const status = String(oldAppt.status ?? "").toLowerCase();

    if (status === "canceled") {
      return NextResponse.json(
        { ok: false, error: "Appointment canceled" },
        { status: 409 }
      );
    }

    const rescheduleCount = Number(oldAppt.reschedule_count ?? 0);

    if (rescheduleCount >= 2) {
      return NextResponse.json(
        {
          ok: false,
          error: "reschedule_limit_reached",
          message: "Esta cita ya fue reagendada el máximo permitido (2 veces).",
          meta: {
            max: 2,
            used: rescheduleCount,
          },
        },
        { status: 403 }
      );
    }

    // 3) Update (DESPUÉS)
    const rescheduled_at = new Date().toISOString();

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("appointments")
      .update({
        start_at,
        end_at,
        rescheduled_at,
        reschedule_count: rescheduleCount + 1, // 👈 incrementamos
      })
      .eq("manage_token", token)
      .neq("status", "canceled")
      .select("*")
      .maybeSingle();

    if (upErr) {
      console.error("Update error:", upErr);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Invalid token or canceled" },
        { status: 404 }
      );
    }

    // 4) Traer admin_email del tenant (MULTI-TENANT)
    const tenant_id = updated.tenant_id ?? oldAppt.tenant_id ?? null;

    let admin_email: string | null = null;

    if (tenant_id) {
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("admin_email")
        .eq("id", tenant_id)
        .single();

      admin_email = tenant?.admin_email ?? null;
    }

    // 5) Llamar a n8n (si hay envs)
    const secret = process.env.CITAYA_SECRET;
    const webhookUrl = process.env.N8N_RESCHEDULE_WEBHOOK_URL;

    let n8n = {
      called: false,
      ok: false as boolean,
      status: 0 as number,
      result: null as any,
    };

    if (secret && webhookUrl) {
      const payload = {
        kind: "reschedule",
        appointment_id: updated.id,
        tenant_id,
        admin_email,
        old: {
          start_at: oldAppt.start_at,
          end_at: oldAppt.end_at,
        },
        new: {
          start_at: updated.start_at,
          end_at: updated.end_at,
        },
        updated_at: updated.rescheduled_at ?? rescheduled_at,
        source: "client",
      };

      try {
        const resp = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-citaya-secret": secret,
          },
          body: JSON.stringify(payload),
        });

        n8n.called = true;
        n8n.status = resp.status;

        const text = await resp.text().catch(() => "");
        try {
          n8n.result = text ? JSON.parse(text) : null;
        } catch {
          n8n.result = text || null;
        }

        n8n.ok = resp.ok;
      } catch (err: any) {
        console.error("n8n fetch failed:", err);
        n8n.called = true;
        n8n.ok = false;
        n8n.result = { error: "fetch_failed", details: String(err?.message ?? err) };
      }
    }

    return NextResponse.json({
      ok: true,
      appointment: updated,
      old: { start_at: oldAppt.start_at, end_at: oldAppt.end_at },
      n8n,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}