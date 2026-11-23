import { requireTenantAdmin } from "@/lib/api/requireTenantAdmin"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const demoSlug = "demo"

export async function requireSettlementsDemoAdmin(req: Request) {
  const expectedHost = process.env.CITAYA_SETTLEMENTS_DEMO_HOST?.trim().toLowerCase()
  const requestHost = req.headers.get("host")?.trim().toLowerCase()
  if (
    process.env.NEXT_PUBLIC_CITAYA_SETTLEMENTS_DEMO !== "true" ||
    !expectedHost || requestHost !== expectedHost
  ) {
    return { ok: false as const, status: 404 }
  }

  if (!req.headers.get("authorization")?.match(/^Bearer\s+\S+$/i)) {
    return { ok: false as const, status: 401 }
  }

  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("slug", demoSlug)
    .eq("lifecycle_status", "active")
    .eq("operational_mode", "demo")
    .maybeSingle()

  if (error || !tenant) return { ok: false as const, status: error ? 503 : 404 }

  const access = await requireTenantAdmin({ req, tenantId: tenant.id, tenantSlug: demoSlug })
  if (!access.ok) return access
  if (access.authMode !== "tenant_members") return { ok: false as const, status: 403 }
  if (access.operationalMode !== "demo") return { ok: false as const, status: 404 }
  return access
}
