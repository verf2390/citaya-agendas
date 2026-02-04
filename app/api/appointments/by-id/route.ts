import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("appointments")
    .select(
      "id, start_at, end_at, customer_name, customer_phone, customer_email, professional_id, tenant_id, service_name"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Cita no encontrada" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, appointment: data });
}
