import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveTenantOperationalCapabilities } from "@/lib/tenant/operational-mode.mjs";

if (typeof window !== "undefined") {
  throw new Error("M2M authentication is server-only");
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_RE = /^[0-9a-f]{64,256}$/i;
const DUMMY_SECRET = "0".repeat(64);

export type M2MAuthResult =
  | {
      ok: true;
      tenantId: string;
      tenantSlug: string;
      serviceId: "n8n";
      authMode: "m2m";
      operationalMode: "demo" | "live" | "internal";
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

class M2MConfigurationError extends Error {}

function bearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function tenantIdHeader(req: Request) {
  return (req.headers.get("x-citaya-tenant-id") ?? "").trim().toLowerCase();
}

function configuredCredentials(): Record<string, string> {
  const raw = String(process.env.M2M_CREDENTIALS_JSON ?? "").trim();
  if (!raw) throw new M2MConfigurationError("missing");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new M2MConfigurationError("invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new M2MConfigurationError("invalid_shape");
  }

  const credentials: Record<string, string> = {};
  for (const [rawTenantId, rawSecret] of Object.entries(parsed)) {
    const tenantId = rawTenantId.trim().toLowerCase();
    const secret = typeof rawSecret === "string" ? rawSecret.trim() : "";
    if (!UUID_RE.test(tenantId) || !SECRET_RE.test(secret)) {
      throw new M2MConfigurationError("invalid_entry");
    }
    credentials[tenantId] = secret;
  }
  if (Object.keys(credentials).length === 0) {
    throw new M2MConfigurationError("empty");
  }
  return credentials;
}

function sameSecret(expected: string, presented: string) {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}

export async function requireM2M(req: Request): Promise<M2MAuthResult> {
  const tenantId = tenantIdHeader(req);
  const presentedSecret = bearerToken(req);
  if (!UUID_RE.test(tenantId) || !presentedSecret) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  let credentials: Record<string, string>;
  try {
    credentials = configuredCredentials();
  } catch {
    return { ok: false, error: "M2M authentication unavailable", status: 500 };
  }

  const expectedSecret = credentials[tenantId];
  const secretMatches = sameSecret(expectedSecret ?? DUMMY_SECRET, presentedSecret);
  if (!expectedSecret || !secretMatches) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("id, slug, lifecycle_status, operational_mode")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: "M2M tenant validation unavailable", status: 500 };
  }
  if (!tenant?.id || tenant.id !== tenantId) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const operational = resolveTenantOperationalCapabilities({
    lifecycleStatus: tenant.lifecycle_status,
    operationalMode: tenant.operational_mode,
  });
  if (!operational.ordinaryAdmin) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  return {
    ok: true,
    tenantId,
    tenantSlug: String(tenant.slug ?? ""),
    serviceId: "n8n",
    authMode: "m2m",
    operationalMode: operational.operationalMode,
  };
}
