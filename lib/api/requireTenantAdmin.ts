import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

export type RequireTenantAdminInput = {
  req: Request;
  tenantId: string;
  tenantSlug?: string | null;
};

export type TenantAdminAuthMode =
  | "tenant_members"
  | "platform_admin"
  | "legacy_host_tenant_match";

export type RequireTenantAdminResult =
  | {
      ok: true;
      tenantId: string;
      tenantSlug: string;
      userId: string;
      authMode: TenantAdminAuthMode;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

type MembershipCheck =
  | { configured: true; allowed: boolean }
  | { configured: false; allowed: false };

const TENANT_ADMIN_ROLES = new Set(["owner", "admin"]);

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

function getErrorCode(error: { code?: string } | null | undefined) {
  return String(error?.code ?? "");
}

function getErrorMessage(error: { message?: string } | null | undefined) {
  return String(error?.message ?? "").toLowerCase();
}

function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("table") && message.includes("not found"))
  );
}

function isMissingSchemaError(error: { code?: string; message?: string } | null | undefined) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return (
    isMissingTableError(error) ||
    code === "42703" ||
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("schema cache")
  );
}

async function checkTenantMembership(input: {
  tenantId: string;
  userId: string;
}): Promise<MembershipCheck> {
  const withActive = await supabaseAdmin
    .from("tenant_members")
    .select("tenant_id, user_id, role, active")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (!withActive.error) {
    const row = withActive.data as { role?: string | null; active?: boolean | null } | null;
    return {
      configured: true,
      allowed:
        Boolean(row) &&
        row?.active !== false &&
        TENANT_ADMIN_ROLES.has(String(row?.role ?? "").toLowerCase()),
    };
  }

  if (!isMissingSchemaError(withActive.error)) {
    return { configured: true, allowed: false };
  }

  const withoutActive = await supabaseAdmin
    .from("tenant_members")
    .select("tenant_id, user_id, role")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (withoutActive.error) {
    return isMissingTableError(withoutActive.error)
      ? { configured: false, allowed: false }
      : { configured: true, allowed: false };
  }

  const row = withoutActive.data as { role?: string | null } | null;
  return {
    configured: true,
    allowed: Boolean(row) && TENANT_ADMIN_ROLES.has(String(row?.role ?? "").toLowerCase()),
  };
}

async function checkPlatformAdmin(userId: string): Promise<MembershipCheck> {
  const withActive = await supabaseAdmin
    .from("platform_admins")
    .select("user_id, active")
    .eq("user_id", userId)
    .maybeSingle();

  if (!withActive.error) {
    const row = withActive.data as { active?: boolean | null } | null;
    return { configured: true, allowed: Boolean(row) && row?.active !== false };
  }

  if (!isMissingSchemaError(withActive.error)) {
    return { configured: true, allowed: false };
  }

  const withoutActive = await supabaseAdmin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (withoutActive.error) {
    return isMissingTableError(withoutActive.error)
      ? { configured: false, allowed: false }
      : { configured: true, allowed: false };
  }

  return { configured: true, allowed: Boolean(withoutActive.data) };
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

  const userId = userData.user.id;
  const [tenantMembership, platformAdmin] = await Promise.all([
    checkTenantMembership({ tenantId: tenant.id as string, userId }),
    checkPlatformAdmin(userId),
  ]);

  if (tenantMembership.allowed) {
    return {
      ok: true,
      tenantId: tenant.id as string,
      tenantSlug: tenant.slug as string,
      userId,
      authMode: "tenant_members",
    };
  }

  if (platformAdmin.allowed) {
    return {
      ok: true,
      tenantId: tenant.id as string,
      tenantSlug: tenant.slug as string,
      userId,
      authMode: "platform_admin",
    };
  }

  if (!tenantMembership.configured && !platformAdmin.configured) {
    return {
      ok: true,
      tenantId: tenant.id as string,
      tenantSlug: tenant.slug as string,
      userId,
      authMode: "legacy_host_tenant_match",
    };
  }

  return {
    ok: false,
    error: "Usuario sin permisos admin para este tenant",
    status: 403,
  };
}
