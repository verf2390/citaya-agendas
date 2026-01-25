import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normalizeIso(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return s;

  // Si viene "YYYY-MM-DD HH:mm:ss+00" => "YYYY-MM-DDTHH:mm:ss+00"
  // Esto evita interpretaciones raras en new Date()
  if (s.includes(" ")) return s.replace(" ", "T");

  return s;
}

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

  // ✅ Normalizar timestamps para asegurar ISO estable hacia el frontend
  const appointment = {
    ...data,
    start_at: normalizeIso(data.start_at),
    end_at: normalizeIso(data.end_at),
  };

  return NextResponse.json({ ok: true, appointment });
}
