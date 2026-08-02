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
      .select("id, name, slug, lifecycle_status")
      .eq("slug", tenant)
      .eq("lifecycle_status", "active")
      .maybeSingle();

    if (terr) throw terr;
    if (!t?.id) {
      return NextResponse.json({ error: "Tenant no existe" }, { status: 404 });
    }

    // servicios activos
    const { data, error } = await supabaseAdmin
      .from("services")
      .select("id,tenant_id,name,public_description,duration_min,price,currency,is_active,payment_policy,deposit_type,deposit_value,deposit_min_amount,deposit_max_amount,deposit_tax_document_policy_status,provisional_expiry_minutes,payment_configuration_complete")
      .eq("tenant_id", t.id)
      .eq("is_active", true)
      .eq("payment_configuration_complete", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json(
      {
        tenant: { id: t.id, name: t.name, slug: t.slug },
        services: data ?? [],
      },
      { status: 200 },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error interno";
    console.error("services/by-tenant error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
