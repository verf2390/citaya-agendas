import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select(
      "id, tenant_id, professional_id, customer_name, customer_phone, customer_email, start_at, end_at, status"
    )
    .eq("manage_token", token)
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, appointment: data });
}
