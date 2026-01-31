// app/api/appointments/reschedule-by-id/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" as any });
    return resp;
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const appointment_id = String(body?.appointment_id ?? "").trim();
    const new_start_at_raw = String(body?.new_start_at ?? "").trim();
    const new_end_at_raw = String(body?.new_end_at ?? "").trim();

    // ✅ Se recomienda que el front envíe tenant_id (ya lo estás haciendo)
    const tenant_id_from_body = String(body?.tenant_id ?? "").trim();

    if (!appointment_id || !new_start_at_raw || !new_end_at_raw) {
      return NextResponse.json(
        { ok: false, error: "Missing appointment_id/new_start_at/new_end_at" },
        { status: 400 },
      );
    }

    if (!isUuid(appointment_id)) {
      return NextResponse.json({ ok: false, error: "Invalid appointment_id" }, { status: 400 });
    }

    // ✅ Normalizar fechas y validar rango
    const new_start_at = new Date(new_start_at_raw).toISOString();
    const new_end_at = new Date(new_end_at_raw).toISOString();

    if (!(new Date(new_end_at).getTime() > new Date(new_start_at).getTime())) {
      return NextResponse.json({ ok: false, error: "Invalid time range" }, { status: 400 });
    }

    // 1) Leer cita actual (ANTES)
    const { data: oldAppt, error: oldErr } = await supabaseAdmin
      .from("appointments")
      .select("id, tenant_id, professional_id, start_at, end_at, status")
      .eq("id", appointment_id)
      .maybeSingle();

    if (oldErr) {
      return NextResponse.json(
        { ok: false, error: "DB error reading appointment", details: oldErr.message },
        { status: 500 },
      );
    }

    if (!oldAppt) {
      return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
    }

    const tenant_id = oldAppt.tenant_id ?? null;

    // ✅ Validación multi-tenant: si el front manda tenant_id, debe coincidir
    if (tenant_id_from_body && tenant_id && tenant_id_from_body !== tenant_id) {
      return NextResponse.json(
        { ok: false, error: "Tenant mismatch for appointment" },
        { status: 403 },
      );
    }

    // ✅ No permitir reagendar citas canceladas (opcional pero sano)
    if (oldAppt.status === "canceled") {
      return NextResponse.json(
        { ok: false, error: "Cannot reschedule a canceled appointment" },
        { status: 409 },
      );
    }

    // 1.5) Chequear overlap en backend (barrera final)
    // Se cruza si: new_start < existing_end AND new_end > existing_start
    const { data: conflicts, error: conflictErr } = await supabaseAdmin
      .from("appointments")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("professional_id", oldAppt.professional_id)
      .neq("status", "canceled")
      .neq("id", appointment_id)
      .lt("start_at", new_end_at)
      .gt("end_at", new_start_at)
      .limit(1);

    if (conflictErr) {
      return NextResponse.json(
        { ok: false, error: "DB error checking overlap", details: conflictErr.message },
        { status: 500 },
      );
    }

    if ((conflicts?.length ?? 0) > 0) {
      return NextResponse.json(
        { ok: false, error: "Time slot already booked" },
        { status: 409 },
      );
    }

    // 2) Update (DESPUÉS)
    const rescheduled_at = new Date().toISOString();

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("appointments")
      .update({
        start_at: new_start_at,
        end_at: new_end_at,
        rescheduled_at,
      })
      .eq("id", appointment_id)
      .select("id, tenant_id, professional_id, start_at, end_at, status, rescheduled_at")
      .single();

    if (upErr || !updated) {
      return NextResponse.json(
        { ok: false, error: "Failed to update appointment", details: upErr?.message },
        { status: 500 },
      );
    }

    // 2.5) Traer admin_email del tenant (MULTI-TENANT)
    let admin_email: string | null = null;

    if (tenant_id) {
      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from("tenants")
        .select("admin_email")
        .eq("id", tenant_id)
        .maybeSingle();

      if (!tenantErr) {
        admin_email = tenant?.admin_email ?? null;
      }
    }

    // 3) Llamar a n8n (si hay envs) SIN romper el reagendado
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
        appointment_id,
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
        updated_at: rescheduled_at,
        source: "admin",
      };

      try {
        const resp = await fetchWithTimeout(
          webhookUrl,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-citaya-secret": secret,
            },
            body: JSON.stringify(payload),
          },
          5000,
        );

        n8n.called = true;
        n8n.status = resp.status;

        const text = await resp.text().catch(() => "");
        try {
          n8n.result = text ? JSON.parse(text) : null;
        } catch {
          n8n.result = text || null;
        }

        n8n.ok = resp.ok;
      } catch (e: any) {
        n8n.called = true;
        n8n.ok = false;
        n8n.status = 0;
        n8n.result = `n8n error: ${String(e?.message ?? e)}`;
      }
    } else {
      n8n = {
        ...n8n,
        called: false,
        result: "Missing env CITAYA_SECRET or N8N_RESCHEDULE_WEBHOOK_URL",
      };
    }

    return NextResponse.json({
      ok: true,
      appointment: updated,
      old: { start_at: oldAppt.start_at, end_at: oldAppt.end_at },
      n8n,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Unhandled error", details: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
