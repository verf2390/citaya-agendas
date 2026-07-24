import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function keyFromEnv(env: NodeJS.ProcessEnv): Buffer {
  const raw = String(env.DTE_PRODUCTION_DATA_KEY ?? "").trim();
  if (!raw) throw new Error("DTE_PRODUCTION_DATA_KEY_MISSING");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("DTE_PRODUCTION_DATA_KEY_INVALID");
  return key;
}

export function protectProductionValue(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): { ciphertext: string; fingerprint: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromEnv(env), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, encrypted]).toString("base64"),
    fingerprint: createHash("sha256").update(value).digest("hex"),
  };
}

export function revealProductionValue(
  ciphertext: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const payload = Buffer.from(ciphertext, "base64");
  if (payload.length < 29) throw new Error("DTE_PROTECTED_VALUE_INVALID");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyFromEnv(env), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}
