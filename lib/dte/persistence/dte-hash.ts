import { createHash } from "node:crypto";

export function sha256String(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
