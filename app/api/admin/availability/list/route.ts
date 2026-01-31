import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

export async function GET(req: Request) {
  try {
    const host = req.headers.get("host") || "";
    const tenantSlug = getTenantSlugFromHostname(host);

    const { searchParams } = new URL(req.url);
    const professionalId = searchParams.get("professionalId");
    if (!professionalId) {
      return NextResponse.json({ error: "professionalId requerido" }, { status: 400 });
    }

    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .single();

    if (tenantErr || !tenant?.id) {
      return NextResponse.json({ error: "tenant no encontrado" }, { status: 404 });
    }

    // Verifica que el profesional pertenece al tenant
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("professionals")
      .select("id")
      .eq("id", professionalId)
      .eq("tenant_id", tenant.id)
      .single();

    if (profErr || !prof?.id) {
      return NextResponse.json({ error: "profesional inválido para este tenant" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("availability")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("tenant_id", tenant.id)
      .eq("professional_id", professionalId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
