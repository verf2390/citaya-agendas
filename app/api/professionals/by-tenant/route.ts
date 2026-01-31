import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

function getHostnameFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "";

  // puede venir con puerto o múltiples hosts por proxy
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

    // 1) obtener tenant id
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .single();

    if (tenantErr || !tenant) {
      return NextResponse.json({ error: "tenant not found" }, { status: 404 });
    }

    // 2) profesionales activos
    const { data: professionals, error: profErr } = await supabaseAdmin
      .from("professionals")
      .select("id, name, bio, avatar_url")
      .eq("tenant_id", tenant.id)
      .eq("active", true)
      .order("created_at", { ascending: true });

    if (profErr) {
      return NextResponse.json(
        { error: "failed to load professionals" },
        { status: 500 }
      );
    }

    return NextResponse.json(professionals ?? []);
  } catch {
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
