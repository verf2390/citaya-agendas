const DEFAULT_ROOT_DOMAIN = "citaya.online";

// Subdominios que NO son tenants
const RESERVED = new Set(["app", "admin", "www", "n8n", "localhost"]);


function isIpHost(host: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

export function normalizeTenantSlug(
  value: string | null | undefined,
): string | null {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;
  if (RESERVED.has(slug)) return null;
  return slug;
}

function rootDomain() {
  return (
    process.env.NEXT_PUBLIC_BASE_DOMAIN?.trim().toLowerCase() ||
    DEFAULT_ROOT_DOMAIN
  ).replace(/^\.+|\.+$/g, "");
}

/**
 * Devuelve el slug si hostname es <slug>.citaya.online
 * Si no aplica, devuelve null.
 * - Nunca lanza excepción
 * - Normaliza
 * - Valida root domain
 * - Filtra reservados e IPs
 */
export function getTenantSlugFromHostname(
  hostname: string | null | undefined,
): string | null {
  try {
    if (!hostname) return null;

    // Normalizar y quitar puerto
    const host = String(hostname).trim().toLowerCase();
    if (!host) return null;

    const hostNoPort = host.replace(/\.$/, "").split(":")[0];
    if (!hostNoPort) return null;

    // localhost / ip
    if (hostNoPort === "localhost" || hostNoPort.endsWith(".localhost"))
      return null;
    if (isIpHost(hostNoPort)) return null;

    // Solo aplica para *.citaya.online
    const baseDomain = rootDomain();
    if (!baseDomain || !hostNoPort.endsWith(`.${baseDomain}`)) return null;

    // Extrae lo que queda a la izquierda del root (ej: "fajaspaola" o "foo.bar")
    const left = hostNoPort.slice(0, -`.${baseDomain}`.length);
    if (!left) return null;

    // slug = primer label antes del root
    const slug = left.split(".")[0]?.trim();
    if (!slug) return null;

    return normalizeTenantSlug(slug);
  } catch {
    return null;
  }
}
// ✅ Cookie usada para forzar tenant demo (compartida a subdominios)
export const DEMO_TENANT_COOKIE = "citaya_demo_tenant";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

/**
 * Lee tenant_id demo desde el header Cookie (si existe)
 * - No lanza excepción
 * - Valida UUID
 */
export function getDemoTenantIdFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  try {
    if (!cookieHeader) return null;

    // Parse simple de cookies: "a=1; b=2"
    const parts = cookieHeader.split(";").map((p) => p.trim());
    const found = parts.find((p) => p.startsWith(`${DEMO_TENANT_COOKIE}=`));
    if (!found) return null;

    const value = found.slice(`${DEMO_TENANT_COOKIE}=`.length).trim();
    if (!value) return null;

    // decode por si viene url-encoded
    const decoded = decodeURIComponent(value);
    return isUuid(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
