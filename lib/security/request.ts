import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function firstForwardedIp(value: string | null) {
  return String(value ?? "").split(",")[0]?.trim() || "unknown";
}

export function requestIp(req: Request) {
  return (
    firstForwardedIp(req.headers.get("x-forwarded-for")) ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export function normalizedIdentity(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160);
}

export function opaqueKey(...parts: unknown[]) {
  return createHash("sha256")
    .update(parts.map((part) => normalizedIdentity(part)).join("\u001f"))
    .digest("hex");
}

export function idempotencyKey(req: Request, bodyValue?: unknown) {
  const value =
    req.headers.get("idempotency-key") ||
    (typeof bodyValue === "string" ? bodyValue : "");
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{16,128}$/.test(trimmed) ? trimmed : "";
}

export async function consumeRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowSeconds: number;
}) {
  const { data, error } = await supabaseAdmin.rpc("consume_api_rate_limit", {
    p_scope: input.scope,
    p_key_hash: opaqueKey(input.key),
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });
  if (error) {
    console.error("[security/rate-limit] unavailable", {
      scope: input.scope,
      code: error.code ?? null,
    });
    return false;
  }
  return data === true;
}
