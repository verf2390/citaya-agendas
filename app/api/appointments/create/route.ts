import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      tenant_id,
      professional_id,
      customer_name,
      customer_phone,
      start_at,
      end_at,
    } = body;

    if (!tenant_id || !professional_id || !customer_name || !start_at || !end_at) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios" },
        { status: 400 }
      );
    }

    // ✅ Evitar choque horario (overlap)
    // Se cruza si: start < existing_end AND end > existing_start
    const { data: conflicts, error: conflictError } = await supabaseServer
      .from("appointments")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("professional_id", professional_id)
      .lt("start_at", end_at)
      .gt("end_at", start_at)
      .limit(1);

    if (conflictError) {
      return NextResponse.json({ error: conflictError.message }, { status: 500 });
    }

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json(
        { error: "Ese horario ya está reservado para ese profesional." },
        { status: 409 }
      );
    }

    const { data, error } = await supabaseServer
      .from("appointments")
      .insert([
        {
          tenant_id,
          professional_id,
          customer_name,
          customer_phone: customer_phone ?? null,
          start_at,
          end_at,
          status: "confirmed",
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, appointment: data }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Error inesperado" },
      { status: 500 }
    );
  }
}
