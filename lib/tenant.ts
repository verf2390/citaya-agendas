const ROOT_DOMAIN = "citaya.online";

// Subdominios que NO son tenants
const RESERVED = new Set(["app", "admin", "www", "n8n", "localhost"]);

function isIpHost(host: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Devuelve el slug si hostname es <slug>.citaya.online
 * Si no aplica, devuelve null.
 * - Nunca lanza excepción
 * - Normaliza
 * - Valida root domain
 * - Filtra reservados e IPs
 */
export function getTenantSlugFromHostname(hostname: string | null | undefined): string | null {
  try {
    if (!hostname) return null;

    // Normalizar y quitar puerto
    const host = String(hostname).trim().toLowerCase();
    if (!host) return null;

    const hostNoPort = host.split(":")[0];
    if (!hostNoPort) return null;

    // localhost / ip
    if (hostNoPort === "localhost" || hostNoPort.endsWith(".localhost")) return null;
    if (isIpHost(hostNoPort)) return null;

    // Solo aplica para *.citaya.online
    if (!hostNoPort.endsWith(`.${ROOT_DOMAIN}`)) return null;

    // Extrae lo que queda a la izquierda del root (ej: "fajaspaola" o "foo.bar")
    const left = hostNoPort.slice(0, -(`.${ROOT_DOMAIN}`.length));
    if (!left) return null;

    // slug = primer label antes del root
    const slug = left.split(".")[0]?.trim();
    if (!slug) return null;

    if (RESERVED.has(slug)) return null;

    return slug;
  } catch {
    return null;
  }
}
