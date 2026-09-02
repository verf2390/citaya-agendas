import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { PreCafExternalDataContract } from "./pre-caf-external-contract";

export type FacturaPreCafInputFile = PreCafExternalDataContract & {
  issueDate?: string | null;
};

export type FacturaPreCafInputLoadResult =
  | { ok: true; input: FacturaPreCafInputFile; issueDate: string; taxPeriod: string }
  | { ok: false; missingFields: string[]; invalidFields: string[] };

function santiagoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function deriveSantiagoTaxPeriod(issueDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new Error("issueDate");
  return issueDate.slice(0, 7);
}

function isInsideRepo(path: string, repoRoot: string): boolean {
  const rel = relative(repoRoot, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

function safeParseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

export function loadFacturaPreCafInputFromPath(options: {
  inputPath?: string | null;
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): FacturaPreCafInputLoadResult {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const inputPath = String(options.inputPath ?? "").trim();
  if (!inputPath) {
    missingFields.push("DTE_FACTURA_PRE_CAF_INPUT_PATH");
    return { ok: false, missingFields, invalidFields };
  }

  const absolutePath = resolve(inputPath);
  const repoRoot = realpathSync(options.repoRoot);
  if (isInsideRepo(absolutePath, repoRoot)) invalidFields.push("DTE_FACTURA_PRE_CAF_INPUT_PATH.outsideRepo");
  if (!existsSync(absolutePath)) {
    missingFields.push("DTE_FACTURA_PRE_CAF_INPUT_FILE");
    return { ok: false, missingFields, invalidFields };
  }

  let realInputPath: string;
  try {
    realInputPath = realpathSync(absolutePath);
  } catch {
    missingFields.push("DTE_FACTURA_PRE_CAF_INPUT_FILE");
    return { ok: false, missingFields, invalidFields };
  }
  if (isInsideRepo(realInputPath, repoRoot)) invalidFields.push("DTE_FACTURA_PRE_CAF_INPUT_PATH.outsideRepo");

  let parsed: unknown;
  try {
    parsed = safeParseJson(readFileSync(realInputPath, "utf8"));
  } catch {
    invalidFields.push("DTE_FACTURA_PRE_CAF_INPUT_JSON");
    return { ok: false, missingFields, invalidFields: [...new Set(invalidFields)].sort() };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalidFields.push("DTE_FACTURA_PRE_CAF_INPUT_JSON_OBJECT");
    return { ok: false, missingFields, invalidFields: [...new Set(invalidFields)].sort() };
  }

  const input = parsed as FacturaPreCafInputFile;
  const envIssueDate = String(options.env?.DTE_FACTURA_PRE_CAF_ISSUE_DATE ?? "").trim();
  const fileIssueDate = String(input.issueDate ?? "").trim();
  const issueDate = envIssueDate || fileIssueDate || santiagoDate(options.now ?? new Date());
  let taxPeriod = "";
  try {
    taxPeriod = deriveSantiagoTaxPeriod(issueDate);
  } catch {
    invalidFields.push("issueDate");
  }

  const issuer = { ...(input.issuer ?? {}) };
  if (issuer.periodoTributario && taxPeriod && issuer.periodoTributario !== taxPeriod) {
    invalidFields.push("issuer.periodoTributarioDerivedFromIssueDate");
  }
  issuer.periodoTributario = taxPeriod || issuer.periodoTributario;
  if (invalidFields.length > 0) {
    return { ok: false, missingFields, invalidFields: [...new Set(invalidFields)].sort() };
  }

  return {
    ok: true,
    input: { ...input, issuer, issueDate },
    issueDate,
    taxPeriod,
  };
}
