import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") ?? "").trim();

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing required param: id" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("services")
      .select("id,tenant_id,name,duration_min,is_active,price,currency")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
    }

    // Seguridad básica: si está inactivo, igual puedes devolverlo o bloquearlo.
    // Yo lo devuelvo, pero marcando is_active para que el front decida.
    const service = {
      id: data.id,
      tenant_id: data.tenant_id,
      name: data.name,
      duration_minutes: data.duration_min ?? null, // ✅ normalizamos nombre para el front
      price: data.price ?? null,
      currency: data.currency ?? null,
      is_active: data.is_active ?? true,
    };

    return NextResponse.json(
      { ok: true, service },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unexpected error" },
      { status: 500 },
    );
  }
}
