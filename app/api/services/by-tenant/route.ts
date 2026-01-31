import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenant = (searchParams.get("tenant") || "").trim();

    if (!tenant) {
      return NextResponse.json({ error: "Falta parámetro tenant" }, { status: 400 });
    }

    // tenant por slug
    const { data: t, error: terr } = await supabaseAdmin
      .from("tenants")
      .select("id, name, slug")
      .eq("slug", tenant)
      .maybeSingle();

    if (terr) throw terr;
    if (!t?.id) {
      return NextResponse.json({ error: "Tenant no existe" }, { status: 404 });
    }

    // servicios activos
    const { data, error } = await supabaseAdmin
      .from("services")
      .select("id, tenant_id, name, duration_min, price, currency, is_active, icon, image_url")
      .eq("tenant_id", t.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json(
      {
        tenant: { id: t.id, name: t.name, slug: t.slug },
        services: data ?? [],
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("services/by-tenant error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Error interno" },
      { status: 500 },
    );
  }
}
