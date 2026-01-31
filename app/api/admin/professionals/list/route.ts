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

function isUuid(v: string) {
  // UUID v4-ish: 8-4-4-4-12 hex
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // ✅ Soportamos tenantId directo (admin) o tenant slug (query) o subdominio
    const tenantIdFromQuery = searchParams.get("tenantId")?.trim() || "";
    const tenantFromQuery = searchParams.get("tenant")?.trim() || "";

    const hostname = getHostnameFromReq(req);
    const slugFromHost = getTenantSlugFromHostname(hostname) || "";

    // 1) Resolver tenantId
    let tenantId = "";

    // Caso A: tenantId explícito
    if (tenantIdFromQuery) {
      if (!isUuid(tenantIdFromQuery)) {
        return NextResponse.json({ error: "tenantId invalid uuid" }, { status: 400 });
      }
      tenantId = tenantIdFromQuery;
    } else {
      // Caso B: tenant slug por query o por subdominio
      const tenantSlug = tenantFromQuery || slugFromHost;

      if (!tenantSlug) {
        return NextResponse.json(
          { error: "tenant required (tenantId or tenant slug or subdomain)" },
          { status: 400 },
        );
      }

      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("slug", tenantSlug)
        .maybeSingle();

      if (tenantErr) {
        console.error("[admin/professionals/list] tenant lookup error:", tenantErr);
        return NextResponse.json({ error: "db error" }, { status: 500 });
      }

      if (!tenant?.id) {
        return NextResponse.json({ error: "tenant not found" }, { status: 404 });
      }

      tenantId = tenant.id;
    }

    // 2) Listar profesionales SOLO del tenant
    const { data, error } = await supabaseAdmin
      .from("professionals")
      .select("id, tenant_id, name, active, bio, avatar_url, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[admin/professionals/list] db error:", error);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }

    // ✅ Respuesta consistente con el front corregido:
    // - professionals incluye tenant_id por item
    // - tenant_id top-level
    return NextResponse.json({
      tenant_id: tenantId,
      professionals: data ?? [],
    });
  } catch (e: any) {
    console.error("[admin/professionals/list] unexpected:", e?.message || e);
    return NextResponse.json({ error: "unexpected error" }, { status: 500 });
  }
}
