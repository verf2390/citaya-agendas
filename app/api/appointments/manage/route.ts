// app/api/appointments/manage/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * GET /api/appointments/manage?token=...
 * Devuelve la cita asociada al manage_token (gestión sin login).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

 const supabase = supabaseServer;


  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, tenant_id, professional_id, start_at, end_at, status, customer_name, customer_phone, customer_email, manage_token, canceled_at, rescheduled_at, reminder_24h_sent_at, reminder_2h_sent_at"
    )
    .eq("manage_token", token)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  return NextResponse.json({ appointment: data }, { status: 200 });
}
