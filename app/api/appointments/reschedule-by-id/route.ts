// app/api/appointments/reschedule-by-id/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const appointment_id = String(body?.appointment_id ?? "").trim();
    const new_start_at = String(body?.new_start_at ?? "").trim();
    const new_end_at = String(body?.new_end_at ?? "").trim();

    if (!appointment_id || !new_start_at || !new_end_at) {
      return NextResponse.json(
        { ok: false, error: "Missing appointment_id/new_start_at/new_end_at" },
        { status: 400 }
      );
    }

    // 1) Leer cita actual (ANTES)
    const { data: oldAppt, error: oldErr } = await supabaseAdmin
      .from("appointments")
      .select("*")
      .eq("id", appointment_id)
      .single();

    if (oldErr || !oldAppt) {
      return NextResponse.json(
        { ok: false, error: "Appointment not found", details: oldErr?.message },
        { status: 404 }
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
      .select("*")
      .single();

    if (upErr || !updated) {
      return NextResponse.json(
        { ok: false, error: "Failed to update appointment", details: upErr?.message },
        { status: 500 }
      );
    }

    // 2.5) Traer admin_email del tenant (MULTI-TENANT)
    const tenant_id = updated.tenant_id ?? oldAppt.tenant_id ?? null;

    let admin_email: string | null = null;

    if (tenant_id) {
      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from("tenants")
        .select("admin_email")
        .eq("id", tenant_id)
        .single();

      if (!tenantErr) {
        admin_email = tenant?.admin_email ?? null;
      }
    }

    // 3) Llamar a n8n (si hay envs)
    const secret = process.env.CITAYA_SECRET;
    const webhookUrl = process.env.N8N_RESCHEDULE_WEBHOOK_URL;

    let n8n = {
      called: false,
      ok: false as boolean,
      status: 0 as number,
      result: null as any,
    };

    if (!secret || !webhookUrl) {
      return NextResponse.json({
        ok: true,
        appointment: updated,
        old: { start_at: oldAppt.start_at, end_at: oldAppt.end_at },
        n8n: {
          ...n8n,
          called: false,
          result: "Missing env CITAYA_SECRET or N8N_RESCHEDULE_WEBHOOK_URL",
        },
      });
    }

    const payload = {
      kind: "reschedule",
      appointment_id,
      tenant_id,
      admin_email, // 👈 MULTI-TENANT
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

    return NextResponse.json({
      ok: true,
      appointment: updated,
      old: { start_at: oldAppt.start_at, end_at: oldAppt.end_at },
      n8n,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Unhandled error", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}