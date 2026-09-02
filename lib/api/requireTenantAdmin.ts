import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import { resolveTenantOperationalCapabilities } from "@/lib/tenant/operational-mode.mjs";

export type RequireTenantAdminInput = {
  req: Request;
  tenantId: string;
  tenantSlug?: string | null;
};

export type TenantAdminAuthMode = "tenant_members" | "platform_admin";

export type RequireTenantAdminResult =
  | {
      ok: true;
      tenantId: string;
      tenantSlug: string;
      userId: string;
      authMode: TenantAdminAuthMode;
      operationalMode: "unclassified" | "demo" | "live" | "internal";
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

type MembershipCheck = { allowed: boolean; failed: boolean };

const TENANT_ADMIN_ROLES = new Set(["owner", "admin"]);
const PLATFORM_ADMIN_ROLES = new Set(["super_admin"]);

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function getTenantSlugFromReq(req: Request, fallback?: string | null): string {
  return (
    getTenantSlugFromHostname(getHostnameFromReq(req)) ||
    String(fallback ?? "").trim()
  );
}

async function checkTenantMembership(input: {
  tenantId: string;
  userId: string;
}): Promise<MembershipCheck> {
  const { data, error } = await supabaseAdmin
    .from("tenant_members")
    .select("tenant_id, user_id, role, is_active")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) return { allowed: false, failed: true };
  const row = data as {
    role?: string | null;
    is_active?: boolean | null;
  } | null;
  return {
    failed: false,
    allowed:
      Boolean(row) &&
      row?.is_active === true &&
      TENANT_ADMIN_ROLES.has(String(row?.role ?? "").toLowerCase()),
  };
}

async function checkPlatformAdmin(userId: string): Promise<MembershipCheck> {
  const { data, error } = await supabaseAdmin
    .from("platform_admins")
    .select("user_id, role, is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { allowed: false, failed: true };
  const row = data as {
    role?: string | null;
    is_active?: boolean | null;
  } | null;
  return {
    failed: false,
    allowed:
      Boolean(row) &&
      row?.is_active === true &&
      PLATFORM_ADMIN_ROLES.has(String(row?.role ?? "").toLowerCase()),
  };
}

export async function requireTenantAdmin(
  input: RequireTenantAdminInput,
): Promise<RequireTenantAdminResult> {
  const token = getBearerToken(input.req);
  if (!token) return { ok: false, error: "Unauthorized", status: 401 };

  const { data: userData, error: userError } =
    await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  const tenantId = input.tenantId.trim();
  if (!tenantId) return { ok: false, error: "tenantId requerido", status: 400 };

  const tenantSlug = getTenantSlugFromReq(input.req, input.tenantSlug);
  let tenantQuery = supabaseAdmin
    .from("tenants")
    .select("id, slug, lifecycle_status, operational_mode")
    .eq("id", tenantId);
  if (tenantSlug) tenantQuery = tenantQuery.eq("slug", tenantSlug);
  const { data: tenant, error: tenantError } = await tenantQuery.maybeSingle();

  if (tenantError) {
    return {
      ok: false,
      error: "No se pudo validar la autorización",
      status: 500,
    };
  }

  if (!tenant?.id) {
    return {
      ok: false,
      error: "Tenant no autorizado o inexistente",
      status: 403,
    };
  }

  const userId = userData.user.id;
  const [tenantMembership, platformAdmin] = await Promise.all([
    checkTenantMembership({ tenantId: tenant.id as string, userId }),
    checkPlatformAdmin(userId),
  ]);
  const operational = resolveTenantOperationalCapabilities({
    lifecycleStatus: tenant.lifecycle_status,
    operationalMode: tenant.operational_mode,
  });

  if (tenant.lifecycle_status === "archived" && !platformAdmin.allowed) {
    return { ok: false, error: "Tenant archivado", status: 403 };
  }

  if (tenantMembership.failed || platformAdmin.failed) {
    return {
      ok: false,
      error: "No se pudo validar la autorización",
      status: 500,
    };
  }

  if (tenantMembership.allowed && tenant.lifecycle_status !== "archived") {
    if (!operational.ordinaryAdmin) {
      return { ok: false, error: "Tenant no clasificado para administración ordinaria", status: 403 };
    }
    return {
      ok: true,
      tenantId: tenant.id as string,
      tenantSlug: tenant.slug as string,
      userId,
      authMode: "tenant_members",
      operationalMode: operational.operationalMode,
    };
  }

  if (platformAdmin.allowed) {
    if (tenant.lifecycle_status === "archived") {
      const audit = await supabaseAdmin.rpc("record_tenant_exceptional_access", {
        p_tenant_id: tenant.id,
        p_actor_user_id: userId,
        p_access_context: "require_tenant_admin",
      });
      if (audit.error) return { ok: false, error: "No se pudo auditar el acceso excepcional", status: 500 };
    }
    return {
      ok: true,
      tenantId: tenant.id as string,
      tenantSlug: tenant.slug as string,
      userId,
      authMode: "platform_admin",
      operationalMode: operational.operationalMode,
    };
  }

  return {
    ok: false,
    error: "Usuario sin permisos admin para este tenant",
    status: 403,
  };
}

export async function requirePlatformAdmin(req: Request): Promise<
  { ok: true; userId: string } | { ok: false; error: string; status: number }
> {
  const token = getBearerToken(req);
  if (!token) return { ok: false, error: "Unauthorized", status: 401 };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) return { ok: false, error: "Unauthorized", status: 401 };
  const platform = await checkPlatformAdmin(data.user.id);
  if (platform.failed) return { ok: false, error: "No se pudo validar la autorización", status: 500 };
  if (!platform.allowed) return { ok: false, error: "Platform admin requerido", status: 403 };
  return { ok: true, userId: data.user.id };
}


export async function requireHostTenantAdmin(req: Request): Promise<RequireTenantAdminResult> {
  const host = getHostnameFromReq(req);
  const tenantSlug = getTenantSlugFromHostname(host);
  if (!tenantSlug) {
    return { ok: false, error: "No se pudo resolver el tenant del hostname", status: 400 };
  }
  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("id, slug, lifecycle_status, operational_mode")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error) {
    return { ok: false, error: "No se pudo validar el tenant", status: 500 };
  }
  if (!tenant?.id || tenant.slug !== tenantSlug) {
    return { ok: false, error: "Tenant no autorizado o inexistente", status: 403 };
  }
  return requireTenantAdmin({ req, tenantId: tenant.id, tenantSlug });
}
