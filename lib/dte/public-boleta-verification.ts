import { createHmac, timingSafeEqual } from "node:crypto";

const DELIVERABLE_SII_STATUSES = new Set([
  "accepted",
  "accepted_with_objections",
  "epr",
  "eok",
]);

type VerificationGrant = {
  tenantId: string;
  documentId: string;
  expiresAt: number;
};

type PublicBoletaVerificationInput = {
  documentType: 39;
  folio: number;
  issueDate: string;
  totalAmount: number;
};

type PublicBoletaDocumentSnapshot = {
  dte_type: unknown;
  folio: unknown;
  issue_date: unknown;
  total_amount: unknown;
  sii_status: unknown;
};

export function isPublicBoletaDeliverableSiiStatus(value: unknown): boolean {
  return DELIVERABLE_SII_STATUSES.has(String(value ?? "").trim().toLowerCase());
}

export function matchesPublicBoletaVerification(
  input: PublicBoletaVerificationInput,
  document: PublicBoletaDocumentSnapshot,
): boolean {
  const dteType = Number(document.dte_type);
  const folio = Number(document.folio);
  const totalAmount = Number(document.total_amount);

  return (
    input.documentType === 39 &&
    dteType === 39 &&
    folio === input.folio &&
    String(document.issue_date ?? "") === input.issueDate &&
    totalAmount === input.totalAmount &&
    isPublicBoletaDeliverableSiiStatus(document.sii_status)
  );
}

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
