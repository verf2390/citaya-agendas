const SAFE_DEFAULT = "/admin";

function repeatedlyDecode(value) {
  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded;
}

export function safeInternalRedirect(value, fallback = SAFE_DEFAULT) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return fallback;
  }

  const decoded = repeatedlyDecode(value.trim());
  if (
    !decoded ||
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(decoded)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(decoded, "https://citaya.invalid");
    if (
      parsed.origin !== "https://citaya.invalid" ||
      !parsed.pathname.startsWith("/") ||
      parsed.pathname.startsWith("//")
    ) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return decoded;
}
