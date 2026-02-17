import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getTenantSlugFromHostname,
  getDemoTenantIdFromCookieHeader,
} from "@/lib/tenant";

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

    const tenantFromQuery = searchParams.get("tenant"); // slug (opcional)
    const hostname = getHostnameFromReq(req);

    // ✅ Si existe cookie demo, manda (tenant_id UUID)
    const demoTenantId = getDemoTenantIdFromCookieHeader(
      req.headers.get("cookie")
    );

    const tenantSlug = tenantFromQuery || getTenantSlugFromHostname(hostname);

    // ✅ Resolver tenantId:
    // 1) demo cookie -> tenantId directo
    // 2) si no hay cookie -> resolver por slug como siempre
    let tenantId: string | null = demoTenantId ?? null;

    if (!tenantId) {
      if (!tenantSlug) {
        return NextResponse.json({ error: "tenant required" }, { status: 400 });
      }

      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("slug", tenantSlug)
        .single();

      if (tenantErr || !tenant) {
        return NextResponse.json({ error: "tenant not found" }, { status: 404 });
      }

      tenantId = tenant.id;
    }

    // 2) profesionales activos
    const { data: professionals, error: profErr } = await supabaseAdmin
      .from("professionals")
      .select("id, name, bio, avatar_url")
      .eq("tenant_id", tenantId)
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
