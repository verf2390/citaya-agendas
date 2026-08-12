const RUT_BODY_PATTERN = /^\d{1,8}$/;
const RUT_DV_PATTERN = /^[0-9K]$/;

export function cleanRut(value: string): string {
  return value.trim().replace(/\./g, "").replace(/\s/g, "").toUpperCase();
}

export function splitRut(value: string): { body: string; dv: string } | null {
  const cleaned = cleanRut(value);
  const match = cleaned.match(/^(\d{1,8})-?([0-9K])$/);
  if (!match) return null;

  const [, body, dv] = match;
  if (!RUT_BODY_PATTERN.test(body) || !RUT_DV_PATTERN.test(dv)) return null;

  return { body, dv };
}

export function calculateRutDv(body: string): string {
  if (!RUT_BODY_PATTERN.test(body)) {
    throw new Error("RUT body must contain 1 to 8 digits");
  }

  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) return "0";
  if (remainder === 10) return "K";
  return String(remainder);
}

export function validateRut(value: string): boolean {
  const parts = splitRut(value);
  if (!parts) return false;

  return calculateRutDv(parts.body) === parts.dv;
}

export function normalizeRut(value: string): string {
  const parts = splitRut(value);
  if (!parts || calculateRutDv(parts.body) !== parts.dv) {
    throw new Error("Invalid Chilean RUT");
  }

  return `${Number(parts.body)}-${parts.dv}`;
}

export function formatRutWithDots(value: string): string {
  const parts = splitRut(value);
  if (!parts) return value;
  const formattedBody = parts.body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formattedBody}-${parts.dv}`;
}

