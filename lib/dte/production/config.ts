import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  isOfficialSiiTrustAnchorProvenance,
  isPinnedSha256,
  isValidSiiTrustAnchorIdk,
} from "../trust-anchor-contract";

export const PRODUCTION_CONFIRMATION_PREFIX = "EMITIR DTE PRODUCCION";

export type ProductionRuntimeConfig = {
  enabled: boolean;
  environment: "production";
  signingMode: "production";
  seedUrl: string;
  tokenUrl: string;
  uploadUrl: string;
  statusUrl: string;
  storageBucket: string;
  cafRoot: string;
  certificateRoot: string;
  privateKeyRoot: string;
  timeoutMs: number;
};

export type ProductionConfigResult =
  | { ok: true; config: ProductionRuntimeConfig }
  | { ok: false; missing: string[]; invalid: string[] };

const REQUIRED = [
  "DTE_PRODUCTION_SEED_URL",
  "DTE_PRODUCTION_TOKEN_URL",
  "DTE_PRODUCTION_UPLOAD_URL",
  "DTE_PRODUCTION_STATUS_URL",
  "DTE_PRODUCTION_STORAGE_BUCKET",
  "DTE_PRODUCTION_CAF_ROOT",
  "DTE_PRODUCTION_CERTIFICATE_ROOT",
  "DTE_PRODUCTION_PRIVATE_KEY_ROOT",
  "DTE_PRODUCTION_TRUST_ANCHOR_IDK",
  "DTE_PRODUCTION_TRUST_ANCHOR_PATH",
  "DTE_PRODUCTION_TRUST_ANCHOR_PROVENANCE",
  "DTE_PRODUCTION_TRUST_ANCHOR_SHA256",
  "DTE_PRODUCTION_DATA_KEY",
] as const;

function value(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] ?? "").trim();
}

function validProductionUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "sii.cl" || host.endsWith(".sii.cl")) &&
      host !== "maullin.sii.cl" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function insideRepo(path: string, repoRoot: string): boolean {
  const rel = relative(resolve(repoRoot), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function validateProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): ProductionConfigResult {
  const missing = REQUIRED.filter((name) => !value(env, name));
  const invalid: string[] = [];
  if (value(env, "DTE_MODE") !== "production") invalid.push("DTE_MODE");
  if (value(env, "DTE_SII_ENV") !== "production") invalid.push("DTE_SII_ENV");
  if (value(env, "DTE_SIGNING_MODE") !== "production")
    invalid.push("DTE_SIGNING_MODE");
  for (const name of [
    "DTE_PRODUCTION_SEED_URL",
    "DTE_PRODUCTION_TOKEN_URL",
    "DTE_PRODUCTION_UPLOAD_URL",
    "DTE_PRODUCTION_STATUS_URL",
  ] as const) {
    const raw = value(env, name);
    if (raw && !validProductionUrl(raw)) invalid.push(name);
  }
  const cafRoot = value(env, "DTE_PRODUCTION_CAF_ROOT");
  if (
    cafRoot &&
    (!isAbsolute(cafRoot) || insideRepo(cafRoot, repoRoot))
  )
    invalid.push("DTE_PRODUCTION_CAF_ROOT");
  for (const pathName of ["DTE_PRODUCTION_CERTIFICATE_ROOT", "DTE_PRODUCTION_PRIVATE_KEY_ROOT", "DTE_PRODUCTION_TRUST_ANCHOR_PATH"] as const) {
    const configuredPath = value(env, pathName);
    if (configuredPath && (!isAbsolute(configuredPath) || insideRepo(configuredPath, repoRoot))) invalid.push(pathName);
  }
  if (
    value(env, "DTE_PRODUCTION_TRUST_ANCHOR_IDK") &&
    !isValidSiiTrustAnchorIdk(
      value(env, "DTE_PRODUCTION_TRUST_ANCHOR_IDK"),
    )
  )
    invalid.push("DTE_PRODUCTION_TRUST_ANCHOR_IDK");
  if (
    value(env, "DTE_PRODUCTION_TRUST_ANCHOR_PROVENANCE") &&
    !isOfficialSiiTrustAnchorProvenance(
      value(env, "DTE_PRODUCTION_TRUST_ANCHOR_PROVENANCE"),
    )
  )
    invalid.push("DTE_PRODUCTION_TRUST_ANCHOR_PROVENANCE");
  if (
    value(env, "DTE_PRODUCTION_TRUST_ANCHOR_SHA256") &&
    !isPinnedSha256(value(env, "DTE_PRODUCTION_TRUST_ANCHOR_SHA256"))
  )
    invalid.push("DTE_PRODUCTION_TRUST_ANCHOR_SHA256");
  if (value(env, "DTE_PRODUCTION_DATA_KEY") && Buffer.from(value(env, "DTE_PRODUCTION_DATA_KEY"), "base64").length !== 32) invalid.push("DTE_PRODUCTION_DATA_KEY");
  const bucket = value(env, "DTE_PRODUCTION_STORAGE_BUCKET");
  if (bucket && (!/^[a-z0-9][a-z0-9_-]{2,62}$/.test(bucket) || /public/i.test(bucket)))
    invalid.push("DTE_PRODUCTION_STORAGE_BUCKET");
  const timeoutMs = Number(value(env, "DTE_PRODUCTION_TIMEOUT_MS") || "30000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000)
    invalid.push("DTE_PRODUCTION_TIMEOUT_MS");
  const enabled = value(env, "DTE_PRODUCTION_ENABLED") === "true";
  if (!enabled) invalid.push("DTE_PRODUCTION_ENABLED");
  if (missing.length || invalid.length)
    return { ok: false, missing: [...missing], invalid: [...new Set(invalid)] };
  return {
    ok: true,
    config: {
      enabled: true,
      environment: "production",
      signingMode: "production",
      seedUrl: value(env, "DTE_PRODUCTION_SEED_URL"),
      tokenUrl: value(env, "DTE_PRODUCTION_TOKEN_URL"),
      uploadUrl: value(env, "DTE_PRODUCTION_UPLOAD_URL"),
      statusUrl: value(env, "DTE_PRODUCTION_STATUS_URL"),
      storageBucket: bucket,
      cafRoot,
      certificateRoot: value(env, "DTE_PRODUCTION_CERTIFICATE_ROOT"),
      privateKeyRoot: value(env, "DTE_PRODUCTION_PRIVATE_KEY_ROOT"),
      timeoutMs,
    },
  };
}

export function assertProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): ProductionRuntimeConfig {
  const result = validateProductionConfig(env, repoRoot);
  if (!result.ok) {
    throw new Error(
      `DTE_PRODUCTION_BLOCKED missing=${result.missing.join(",")} invalid=${result.invalid.join(",")}`,
    );
  }
  return result.config;
}

export function expectedProductionConfirmation(documentId: string): string {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(documentId))
    throw new Error("documentId invalido para confirmacion productiva");
  return `${PRODUCTION_CONFIRMATION_PREFIX} ${documentId}`;
}

export function assertExactProductionConfirmation(
  documentId: string,
  confirmation: string,
): void {
  if (confirmation !== expectedProductionConfirmation(documentId))
    throw new Error("DTE_PRODUCTION_CONFIRMATION_MISMATCH");
}
