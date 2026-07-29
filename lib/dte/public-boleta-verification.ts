import { createHmac, timingSafeEqual } from "node:crypto";

type VerificationGrant = {
  tenantId: string;
  documentId: string;
  expiresAt: number;
};

function secret(): string {
  const value = process.env.CITAYA_MANAGE_TOKEN_PEPPER?.trim();
  if (!value || value.length < 32) {
    throw new Error("BOLETA_VERIFICATION_SECRET_UNAVAILABLE");
  }
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createBoletaPdfGrant(
  input: Omit<VerificationGrant, "expiresAt">,
): string {
  const grant: VerificationGrant = {
    ...input,
    expiresAt: Date.now() + 5 * 60_000,
  };
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyBoletaPdfGrant(value: string): VerificationGrant | null {
  const [payload, supplied] = String(value ?? "").split(".");
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<VerificationGrant>;
    if (
      !parsed.tenantId ||
      !parsed.documentId ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      Number(parsed.expiresAt) < Date.now()
    ) {
      return null;
    }
    return parsed as VerificationGrant;
  } catch {
    return null;
  }
}
