const TRUSTED_STATIC_HOSTS = new Set(["images.unsplash.com"]);

function configuredSupabaseHostname() {
  try {
    const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    return value ? new URL(value).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * @param {string | null | undefined} value
 * @param {string | undefined} origin
 * @returns {string | null}
 */
export function trustedProfessionalAvatarUrl(value, origin) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const base = origin?.trim() || "https://citaya.online";
    const baseUrl = new URL(base);
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "https:" && url.origin !== baseUrl.origin) return null;
    const hostname = url.hostname.toLowerCase();
    const supabaseHost = configuredSupabaseHostname();
    const trustedSupabase =
      Boolean(supabaseHost) &&
      (hostname === supabaseHost ||
        hostname.endsWith(".supabase.co") ||
        hostname.endsWith(".supabase.in"));
    return url.origin === baseUrl.origin ||
      trustedSupabase ||
      TRUSTED_STATIC_HOSTS.has(hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** @param {string} name */
export function professionalInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "PR";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("es-CL") ?? "")
    .join("");
}

/**
 * @param {{ url: string | null | undefined; failed: boolean; name: string; origin?: string }} input
 */
export function professionalAvatarState(input) {
  const src = input.failed
    ? null
    : trustedProfessionalAvatarUrl(input.url, input.origin);
  return { src, initials: professionalInitials(input.name), showImage: Boolean(src) };
}
