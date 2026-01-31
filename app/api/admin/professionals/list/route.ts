import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

function getHostnameFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "";
  return host.split(",")[0].trim().split(":")[0];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const tenantFromQuery = searchParams.get("tenant");
    const hostname = getHostnameFromReq(req);

    const tenantSlug = tenantFromQuery || getTenantSlugFromHostname(hostname);

    if (!tenantSlug) {
      return NextResponse.json({ error: "tenant required" }, { status: 400 });
    }

    // 1) buscar tenant id
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .single();

    if (tenantErr || !tenant?.id) {
      return NextResponse.json({ error: "tenant not found" }, { status: 404 });
    }

    // 2) listar profesionales (admin ve todos)
    const { data, error } = await supabaseAdmin
      .from("professionals")
      .select("id, name, active, bio, avatar_url, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[admin/professionals/list] error:", error);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }

    return NextResponse.json({ tenant_id: tenant.id, professionals: data ?? [] });
  } catch (e: any) {
    console.error("[admin/professionals/list] unexpected:", e?.message || e);
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
