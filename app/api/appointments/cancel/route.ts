// app/api/appointments/cancel/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * POST /api/appointments/cancel
 * Body: { token }
 * Cambia status a canceled y setea canceled_at.
 * Limpia flags de recordatorio para evitar envíos.
 */
export async function POST(req: Request) {
  try {
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const supabase = supabaseServer;

    // Buscar cita por token
    const { data: appt, error: findErr } = await supabase
      .from("appointments")
      .select("id, status")
      .eq("manage_token", token)
      .single();

    if (findErr || !appt) {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    }

    // Idempotente
    if (appt.status === "canceled") {
      return NextResponse.json({ ok: true, alreadyCanceled: true }, { status: 200 });
    }

    const { error: updErr } = await supabase
      .from("appointments")
      .update({
        status: "canceled",
        canceled_at: new Date().toISOString(),
        reminder_24h_sent_at: null,
        reminder_2h_sent_at: null,
      })
      .eq("id", appt.id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error" }, { status: 500 });
  }
}
