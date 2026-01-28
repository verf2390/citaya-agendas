import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const appointment_id = body?.appointment_id;

    if (!appointment_id) {
      return NextResponse.json({ ok: false, error: "Missing appointment_id" }, { status: 400 });
    }

    // 1) Cancelar en DB
    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({
        status: "canceled",
        canceled_at: nowIso,
      })
      .eq("id", appointment_id)
      .select("id, tenant_id, customer_email, canceled_at, status")
      .maybeSingle();

    if (error) {
      console.error("[cancel-by-id] DB error:", error);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
    }

    // 2) Llamar a n8n (correo + log)
    const n8nUrl =
      process.env.N8N_CANCEL_WEBHOOK_URL ||
      "https://n8n.citaya.online/webhook/citaya-cancelacion";
    const secret = process.env.CITAYA_SECRET;

    let n8nOk = false;
    let n8nResult: any = null;

    if (!secret) {
      console.warn("[cancel-by-id] Missing CITAYA_SECRET env var. Skipping n8n call.");
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
            reason: "admin_action",
            source: "admin_panel",
          }),
        });

        n8nOk = r.ok;
        n8nResult = await r.json().catch(() => ({ ok: r.ok }));
      } catch (err: any) {
        console.error("[cancel-by-id] n8n call failed:", err?.message || err);
        n8nOk = false;
        n8nResult = { ok: false, error: err?.message || "n8n fetch failed" };
      }
    }

    return NextResponse.json({
      ok: true,
      appointment: data,
      n8n: { called: !!secret, ok: n8nOk, result: n8nResult },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
