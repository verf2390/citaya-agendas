import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";
import { isUuid } from "@/lib/api/validators";

export type TenantAdminTenant = {
  id: string;
  slug: string | null;
  name?: string | null;
  admin_email?: string | null;
};

type RequireTenantAdminOptions = {
  tenantId?: string | null;
  tenantSlug?: string | null;
  body?: Record<string, unknown> | null;
};

type RequireTenantAdminSuccess = {
  ok: true;
  user: User;
  tenantId: string;
  tenant: TenantAdminTenant;
  authorizationMode: "admin_email" | "authenticated_tenant";
};

type RequireTenantAdminFailure = {
  ok: false;
  response: NextResponse;
};

export type RequireTenantAdminResult =
  | RequireTenantAdminSuccess
  | RequireTenantAdminFailure;

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getHostnameFromReq(req: Request) {
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host.split(",")[0]?.trim().split(":")[0] ?? "";
}

function resolveRequestedTenant(req: Request, options: RequireTenantAdminOptions) {
  const url = new URL(req.url);
  const body = options.body ?? null;

  const tenantId =
    cleanText(options.tenantId) ||
    cleanText(body?.tenantId) ||
    cleanText(url.searchParams.get("tenantId"));

  const tenantSlug =
    cleanText(options.tenantSlug) ||
    cleanText(body?.tenantSlug) ||
    cleanText(body?.tenant) ||
    cleanText(url.searchParams.get("tenantSlug")) ||
    cleanText(url.searchParams.get("tenant")) ||
    getTenantSlugFromHostname(getHostnameFromReq(req)) ||
    "";

  return { tenantId, tenantSlug };
}

async function fetchTenantById(tenantId: string) {
  const withAdminEmail = await supabaseAdmin
    .from("tenants")
    .select("id, slug, name, admin_email")
    .eq("id", tenantId)
    .maybeSingle();

  if (!withAdminEmail.error) {
    return withAdminEmail;
  }

  const message = withAdminEmail.error.message ?? "";
  if (!message.includes("admin_email")) {
    return withAdminEmail;
  }

  return supabaseAdmin
    .from("tenants")
    .select("id, slug, name")
    .eq("id", tenantId)
    .maybeSingle();
}

async function fetchTenantBySlug(tenantSlug: string) {
  const withAdminEmail = await supabaseAdmin
    .from("tenants")
    .select("id, slug, name, admin_email")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (!withAdminEmail.error) {
    return withAdminEmail;
  }

  const message = withAdminEmail.error.message ?? "";
  if (!message.includes("admin_email")) {
    return withAdminEmail;
  }

  return supabaseAdmin
    .from("tenants")
    .select("id, slug, name")
    .eq("slug", tenantSlug)
    .maybeSingle();
}

export async function requireTenantAdmin(
  req: Request,
  options: RequireTenantAdminOptions = {},
): Promise<RequireTenantAdminResult> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const { data: userData, error: userError } =
    await supabaseAdmin.auth.getUser(token);

  if (userError || !userData?.user) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const { tenantId, tenantSlug } = resolveRequestedTenant(req, options);

  if (tenantId && !isUuid(tenantId)) {
    return {
      ok: false,
      response: jsonError("tenantId requerido o inválido", 400),
    };
  }

  if (!tenantId && !tenantSlug) {
    return {
      ok: false,
      response: jsonError("No se pudo resolver tenant actual", 400),
    };
  }

  const { data, error } = tenantId
    ? await fetchTenantById(tenantId)
    : await fetchTenantBySlug(tenantSlug);

  if (error) {
    console.error("[requireTenantAdmin] tenant lookup error:", error);
    return {
      ok: false,
      response: jsonError("No se pudo validar el tenant", 500),
    };
  }

  if (!data?.id) {
    return { ok: false, response: jsonError("Tenant no encontrado", 404) };
  }

  const tenant = data as TenantAdminTenant;
  const adminEmail = cleanText(tenant.admin_email).toLowerCase();
  const userEmail = cleanText(userData.user.email).toLowerCase();

  if (adminEmail) {
    if (!userEmail || userEmail !== adminEmail) {
      return {
        ok: false,
        response: jsonError("Forbidden: usuario no administra este tenant", 403),
      };
    }

    return {
      ok: true,
      user: userData.user,
      tenantId: tenant.id,
      tenant,
      authorizationMode: "admin_email",
    };
  }

  return {
    ok: true,
    user: userData.user,
    tenantId: tenant.id,
    tenant,
    authorizationMode: "authenticated_tenant",
  };
}
