import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const token = body?.token;
    const start_at = body?.start_at;
    const end_at = body?.end_at;

    if (!token || !start_at || !end_at) {
      return NextResponse.json(
        { ok: false, error: "Missing token/start_at/end_at" },
        { status: 400 }
      );
    }

    // MVP: no permitir reprogramar si ya está cancelada
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({
        start_at,
        end_at,
        // opcional: marca de auditoría si la columna existe
        rescheduled_at: new Date().toISOString(),
      })
      .eq("manage_token", token)
      .neq("status", "canceled")
      .select("id, status, start_at, end_at")
      .maybeSingle();

    if (error) {
      console.error(error);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Invalid token or canceled" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, appointment: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
