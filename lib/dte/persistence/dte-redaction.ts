import { basename } from "node:path";

import { sha256String } from "./dte-hash";
import type { RedactedSiiResponse } from "./dte-persistence-types";

const SENSITIVE_KEYS = [
  "token",
  "authorization",
  "cookie",
  "privateKey",
  "private_key",
  "certificate",
  "cert",
  "password",
  "secret",
  "cafXml",
] as const;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) =>
    normalized.includes(sensitive.toLowerCase()),
  );
}

export function redactToken(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function fingerprintToken(token: string | null | undefined): string | null {
  if (!token) return null;
  return sha256String(`citaya-dte-token:${token}`);
}

export function redactSensitivePath(pathValue: string | null | undefined): string | null {
  if (!pathValue) return null;
  return `[redacted-path:${basename(pathValue)}:${sha256String(pathValue).slice(0, 12)}]`;
}

export function safeJsonForAudit(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return { value: String(input ?? "") };
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      output[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.includes("-----BEGIN")) {
      output[key] = "[redacted-pem]";
      continue;
    }
    if (typeof value === "object" && value !== null) {
      output[key] = safeJsonForAudit(value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

export function redactSiiResponse(response: unknown): RedactedSiiResponse {
  const safe = safeJsonForAudit(response);
  const status = String(safe.status ?? safe.estado ?? safe.STATUS ?? safe.ESTADO ?? "").trim();
  const trackId = String(
    safe.trackId ?? safe.track_id ?? safe.TRACKID ?? safe.TRACK_ID ?? "",
  ).trim();
  const message = String(safe.message ?? safe.glosa ?? safe.GLOSA ?? "").trim();

  return {
    redacted: true,
    status: status || null,
    trackId: trackId || null,
    message: message || null,
    keys: Object.keys(safe).sort(),
    sha256: sha256String(JSON.stringify(safe)),
  };
}
