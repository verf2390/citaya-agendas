import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

export type RequireTenantAdminInput = {
  req: Request;
  tenantId: string;
  tenantSlug?: string | null;
};

export type RequireTenantAdminResult =
  | {
      ok: true;
      tenantId: string;
      tenantSlug: string;
      userId: string;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function getTenantSlugFromReq(req: Request, fallback?: string | null): string {
  return getTenantSlugFromHostname(getHostnameFromReq(req)) || String(fallback ?? "").trim();
}

export async function requireTenantAdmin(
  input: RequireTenantAdminInput,
): Promise<RequireTenantAdminResult> {
  const token = getBearerToken(input.req);
  if (!token) return { ok: false, error: "Unauthorized", status: 401 };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  const tenantId = input.tenantId.trim();
  if (!tenantId) return { ok: false, error: "tenantId requerido", status: 400 };

  const tenantSlug = getTenantSlugFromReq(input.req, input.tenantSlug);
  if (!tenantSlug) {
    return {
      ok: false,
      error: "No se pudo detectar el tenant actual",
      status: 400,
    };
  }

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .select("id, slug")
    .eq("id", tenantId)
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (tenantError || !tenant?.id) {
    return {
      ok: false,
      error: "Tenant no autorizado o inexistente",
      status: 403,
    };
  }

  return {
    ok: true,
    tenantId: tenant.id as string,
    tenantSlug: tenant.slug as string,
    userId: userData.user.id,
  };
}
