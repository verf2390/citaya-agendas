export function isValidSiiTrustAnchorIdk(value: string): boolean {
  return /^[1-9]\d{0,9}$/.test(value.trim());
}

export function isOfficialSiiTrustAnchorProvenance(
  value: string,
): boolean {
  const prefix = "official:";
  if (!value.startsWith(prefix)) return false;
  try {
    const url = new URL(value.slice(prefix.length));
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "sii.cl" || hostname.endsWith(".sii.cl")) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function isPinnedSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value.trim().toLowerCase());
}
