// app/api/appointments/reschedule/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * POST /api/appointments/reschedule
 * Body: { token, new_start_at }
 * Mantiene duración original y valida que el nuevo slot no choque.
 * Resetea flags de recordatorio (para que vuelvan a enviarse en la nueva fecha).
 */
export async function POST(req: Request) {
  try {
    const { token, new_start_at } = await req.json();

    if (!token || !new_start_at) {
      return NextResponse.json({ error: "Missing token or new_start_at" }, { status: 400 });
    }

    const supabase = supabaseServer;

    // 1) Traer cita actual
    const { data: appt, error: findErr } = await supabase
      .from("appointments")
      .select("id, tenant_id, professional_id, start_at, end_at, status")
      .eq("manage_token", token)
      .single();

    if (findErr || !appt) {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    }

    if (appt.status === "canceled") {
      return NextResponse.json({ error: "Appointment is canceled" }, { status: 400 });
    }

    // 2) Calcular nueva end_at manteniendo duración
    const oldStart = new Date(appt.start_at).getTime();
    const oldEnd = new Date(appt.end_at).getTime();
    const durationMs = oldEnd - oldStart;

    const newStart = new Date(new_start_at);
    const newEnd = new Date(newStart.getTime() + durationMs);

    if (newStart.getTime() < Date.now()) {
      return NextResponse.json({ error: "Cannot reschedule to the past" }, { status: 400 });
    }

    // 3) Validar choque con otras citas confirmadas del mismo profesional/tenant
    const { data: conflicts, error: conflictErr } = await supabase
      .from("appointments")
      .select("id")
      .eq("tenant_id", appt.tenant_id)
      .eq("professional_id", appt.professional_id)
      .eq("status", "confirmed")
      .neq("id", appt.id)
      .lt("start_at", newEnd.toISOString())
      .gt("end_at", newStart.toISOString());

    if (conflictErr) {
      return NextResponse.json({ error: conflictErr.message }, { status: 400 });
    }

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json({ error: "Slot not available" }, { status: 409 });
    }

    // 4) Update + reset flags
    const { error: updErr } = await supabase
      .from("appointments")
      .update({
        start_at: newStart.toISOString(),
        end_at: newEnd.toISOString(),
        rescheduled_at: new Date().toISOString(),
        reminder_24h_sent_at: null,
        reminder_2h_sent_at: null,
      })
      .eq("id", appt.id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, start_at: newStart.toISOString(), end_at: newEnd.toISOString() },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error" }, { status: 500 });
  }
}
