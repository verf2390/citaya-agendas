import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
  }
  const access = await requireTenantAdmin({ req, tenantId });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { data, error } = await supabaseServer
    .from("services")
    .select("id, tenant_id, name, duration_min, price, currency, is_active")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ services: data ?? [] });
}
