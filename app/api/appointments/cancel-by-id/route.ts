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
    const body = await req.json().catch(() => null);

    const appointment_id = String(body?.appointment_id ?? "").trim();
    const tenant_id = String(body?.tenant_id ?? "").trim();

    if (!appointment_id) {
      return NextResponse.json({ ok: false, error: "Missing appointment_id" }, { status: 400 });
    }
    if (!tenant_id) {
      return NextResponse.json({ ok: false, error: "Missing tenant_id" }, { status: 400 });
    }

    if (!isUuid(appointment_id)) {
      return NextResponse.json({ ok: false, error: "Invalid appointment_id" }, { status: 400 });
    }
    if (!isUuid(tenant_id)) {
      return NextResponse.json({ ok: false, error: "Invalid tenant_id" }, { status: 400 });
    }

    // 0) Verificar que la cita exista y pertenezca al tenant
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("id, tenant_id, status, customer_email, professional_id, start_at, end_at")
      .eq("id", appointment_id)
      .maybeSingle();

    if (apptErr) {
      console.error("[cancel-by-id] read error:", apptErr);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!appt) {
      return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
    }

    if (appt.tenant_id !== tenant_id) {
      // 🔒 multi-tenant guard
      return NextResponse.json({ ok: false, error: "Forbidden: tenant mismatch" }, { status: 403 });
    }

    // Config n8n
    const n8nUrl =
      process.env.N8N_CANCEL_WEBHOOK_URL ||
      "https://n8n.citaya.online/webhook/citaya-cancelacion";
    const secret = process.env.CITAYA_SECRET;

    // (Idempotente) si ya está cancelada, responder ok
    if (appt.status === "canceled") {
      return NextResponse.json({
        ok: true,
        appointment: appt,
        n8n: {
          called: !!secret,
          ok: true,
          result: { ok: true, skipped: "already_canceled" },
        },
      });
    }

    // 1) Cancelar en DB (doble filtro por seguridad)
    const nowIso = new Date().toISOString();

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("appointments")
      .update({
        status: "canceled",
        canceled_at: nowIso,
      })
      .eq("id", appointment_id)
      .eq("tenant_id", tenant_id)
      .select("id, tenant_id, customer_email, canceled_at, status, professional_id, start_at, end_at")
      .maybeSingle();

    if (upErr) {
      console.error("[cancel-by-id] update error:", upErr);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Appointment not found for tenant" }, { status: 404 });
    }

    // 2) Llamar a n8n (correo + log) SIN romper la cancelación
    let n8nOk = false;
    let n8nResult: any = null;

    if (!secret) {
      console.warn("[cancel-by-id] Missing CITAYA_SECRET env var. Skipping n8n call.");
      n8nOk = true;
      n8nResult = { ok: true, skipped: "missing_secret" };
    } else {
      try {
        const r = await fetchWithTimeout(
          n8nUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-citaya-secret": secret,
            },
            body: JSON.stringify({
              tenant_id,
              appointment_id: updated.id,
              reason: "admin_action",
              source: "admin_panel",
              // opcional: para emails/logs más completos
              professional_id: updated.professional_id,
              start_at: updated.start_at,
              end_at: updated.end_at,
            }),
          },
          5000,
        );

        n8nOk = r.ok;

        // Intentar json, fallback texto
        const text = await r.text().catch(() => "");
        try {
          n8nResult = text ? JSON.parse(text) : { ok: r.ok };
        } catch {
          n8nResult = text || { ok: r.ok };
        }
      } catch (err: any) {
        console.error("[cancel-by-id] n8n call failed:", err?.message || err);
        n8nOk = false;
        n8nResult = { ok: false, error: err?.message || "n8n fetch failed" };
      }
    }

    return NextResponse.json({
      ok: true,
      appointment: updated,
      n8n: { called: !!secret, ok: n8nOk, result: n8nResult },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
