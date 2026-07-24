import {
  fetchWithClientTimeout,
  withClientTimeout,
} from "@/lib/client/async-timeout";
import {
  getTenantSlugFromHostname,
  normalizeTenantSlug,
} from "@/lib/tenant";

export type ClientTenant = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  [key: string]: unknown;
};

export type TenantResolution =
  | { ok: true; slug: string; tenant: ClientTenant }
  | {
      ok: false;
      slug: string | null;
      code: "invalid_hostname" | "not_found" | "api_error";
      message: string;
    };

type ResolveOptions = {
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
    timeoutMs?: number,
  ) => Promise<Response>;
  timeoutMs?: number;
};

function validTenant(value: unknown, expectedSlug: string): value is ClientTenant {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    row.slug === expectedSlug &&
    typeof row.name === "string" &&
    (row.logo_url === null ||
      row.logo_url === undefined ||
      typeof row.logo_url === "string")
  );
}

export async function resolveTenantBySlug(
  candidate: string | null | undefined,
  options: ResolveOptions = {},
): Promise<TenantResolution> {
  const slug = normalizeTenantSlug(candidate);
  if (!slug) {
    return {
      ok: false,
      slug: null,
      code: "invalid_hostname",
      message: "No se pudo identificar el negocio para este dominio.",
    };
  }

  try {
    const fetchImpl = options.fetchImpl ?? fetchWithClientTimeout;
    const response = await withClientTimeout(fetchImpl(
      `/api/tenants/by-slug?slug=${encodeURIComponent(slug)}`,
      { cache: "no-store" },
      options.timeoutMs,
    ), options.timeoutMs);
    const payload = (await response.json().catch(() => null)) as {
      tenant?: unknown;
    } | null;

    if (response.status === 404) {
      return {
        ok: false,
        slug,
        code: "not_found",
        message: `No existe un negocio configurado para ${slug}.`,
      };
    }

    if (!response.ok || !validTenant(payload?.tenant, slug)) {
      return {
        ok: false,
        slug,
        code: "api_error",
        message:
          "No se pudo cargar el negocio. Revisa tu conexión e inténtalo nuevamente.",
      };
    }

    return { ok: true, slug, tenant: payload.tenant };
  } catch {
    return {
      ok: false,
      slug,
      code: "api_error",
      message:
        "No se pudo cargar el negocio. Revisa tu conexión e inténtalo nuevamente.",
    };
  }
}

export function resolveTenantFromHostname(
  hostname: string | null | undefined,
  options: ResolveOptions = {},
): Promise<TenantResolution> {
  return resolveTenantBySlug(getTenantSlugFromHostname(hostname), options);
}
