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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const professionalId = (searchParams.get("professionalId") || "").trim();
    if (!professionalId) {
      return NextResponse.json({ error: "professionalId requerido" }, { status: 400 });
    }

    // ✅ Preferimos tenantId si viene (admin)
    const tenantIdFromQuery = (searchParams.get("tenantId") || "").trim();

    let tenantId = "";

    if (tenantIdFromQuery) {
      if (!isUuid(tenantIdFromQuery)) {
        return NextResponse.json({ error: "tenantId invalid uuid" }, { status: 400 });
      }
      tenantId = tenantIdFromQuery;
    } else {
      // ✅ fallback por subdominio
      const hostname = getHostnameFromReq(req);
      const tenantSlug = getTenantSlugFromHostname(hostname);

      if (!tenantSlug) {
        return NextResponse.json(
          { error: "tenant requerido (tenantId o subdominio)" },
          { status: 400 },
        );
      }

      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("slug", tenantSlug)
        .maybeSingle();

      if (tenantErr) {
        console.error("[admin/availability/list] tenant lookup error:", tenantErr);
        return NextResponse.json({ error: "db error" }, { status: 500 });
      }

      if (!tenant?.id) {
        return NextResponse.json({ error: "tenant no encontrado" }, { status: 404 });
      }

      tenantId = tenant.id;
    }

    // ✅ Verifica que el profesional pertenece al tenant (seguridad multi-tenant)
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("professionals")
      .select("id")
      .eq("id", professionalId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (profErr) {
      console.error("[admin/availability/list] professional lookup error:", profErr);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }

    if (!prof?.id) {
      return NextResponse.json({ error: "profesional inválido para este tenant" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("availability")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("tenant_id", tenantId)
      .eq("professional_id", professionalId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      console.error("[admin/availability/list] availability query error:", error);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }

    return NextResponse.json({ tenant_id: tenantId, items: data ?? [] });
  } catch (e: any) {
    console.error("[admin/availability/list] unexpected:", e?.message || e);
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
