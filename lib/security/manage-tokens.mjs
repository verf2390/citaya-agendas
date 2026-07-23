import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const MANAGE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateManageToken() {
  return randomBytes(32).toString("base64url");
}

export function hashManageToken(token, pepper) {
  if (!token || !pepper) throw new Error("Manage token configuration missing");
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}

export function safeTokenHashEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function manageTokenExpiresAt(now = Date.now()) {
  return new Date(now + MANAGE_TOKEN_TTL_MS).toISOString();
}

export function isUsableManageTokenRecord(record, now = Date.now()) {
  if (!record || record.manage_token_revoked_at) return false;
  const expiresAt = new Date(record.manage_token_expires_at ?? "").getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function deriveManageToken(tenantId, idempotencyKey, pepper) {
  if (!tenantId || !idempotencyKey || !pepper) {
    throw new Error("Manage token configuration missing");
  }
  return createHmac("sha256", pepper)
    .update(`${tenantId}:${idempotencyKey}`, "utf8")
    .digest("base64url");
}
