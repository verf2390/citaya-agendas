import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { isSupportedDteDocumentType } from "../dte-types";
import { validateRut } from "../rut";
import type { DteXmlBuildMode } from "../types";

export type DteConfigValidationStatus = "OK" | "WARNING" | "MISSING" | "DANGEROUS";

export type DteConfigValidationItem = {
  key: string;
  status: DteConfigValidationStatus;
  message: string;
};

export type DteConfigValidationInput = {
  mode?: string | null;
  issuerRut?: string | null;
  recipientRut?: string | null;
  documentType?: string | null;
  folio?: number | string | null;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
};

const REQUIRED_CERTIFICATION_ENV = [
  "DTE_CAF_PATH",
  "DTE_CAF_PRIVATE_KEY_PATH",
  "DTE_CERT_PATH",
  "DTE_PRIVATE_KEY_PATH",
] as const;

const SECRET_ENV = [
  ...REQUIRED_CERTIFICATION_ENV,
  "DTE_CERT_PASSWORD",
  "DTE_PRIVATE_KEY_PASSWORD",
] as const;

const REPO_SECRET_DIRS = ["docs", "lib", "app", "scripts"];

export function isDteXmlBuildMode(value: string): value is DteXmlBuildMode {
  return value === "lab" || value === "xsd-structure" || value === "certification";
}

export function getDteModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DteXmlBuildMode {
  const mode = String(env.DTE_MODE ?? "lab").trim();
  return isDteXmlBuildMode(mode) ? mode : "lab";
}

export function isPathInsideRepo(pathValue: string, repoRoot = process.cwd()): boolean {
  if (!pathValue.trim()) return false;
  const absolutePath = isAbsolute(pathValue) ? pathValue : resolve(repoRoot, pathValue);
  const realRepoRoot = existsSync(repoRoot) ? realpathSync(repoRoot) : resolve(repoRoot);
  const normalized = existsSync(absolutePath)
    ? realpathSync(absolutePath)
    : resolve(absolutePath);
  const pathRelativeToRepo = relative(realRepoRoot, normalized);
  return Boolean(
    pathRelativeToRepo &&
      !pathRelativeToRepo.startsWith("..") &&
      !isAbsolute(pathRelativeToRepo),
  );
}

export function isSecretPathSuspicious(
  pathValue: string,
  repoRoot = process.cwd(),
): boolean {
  const trimmed = pathValue.trim();
  if (!trimmed) return false;
  if (!isAbsolute(trimmed)) return true;
  if (!isPathInsideRepo(trimmed, repoRoot)) return false;

  const relativePath = relative(repoRoot, resolve(trimmed)).replace(/\\/g, "/");
  return REPO_SECRET_DIRS.some(
    (dir) => relativePath === dir || relativePath.startsWith(`${dir}/`),
  );
}

export function validateDteConfig(
  input: DteConfigValidationInput = {},
): DteConfigValidationItem[] {
  const env = input.env ?? process.env;
  const repoRoot = input.repoRoot ?? process.cwd();
  const mode = String(input.mode ?? env.DTE_MODE ?? "lab").trim();
  const items: DteConfigValidationItem[] = [];

  items.push({
    key: "DTE_MODE",
    status: isDteXmlBuildMode(mode) ? "OK" : "WARNING",
    message: isDteXmlBuildMode(mode)
      ? `Modo DTE reconocido: ${mode}`
      : "Modo DTE no reconocido; usar lab, xsd-structure o certification.",
  });

  if (input.issuerRut !== undefined) {
    items.push({
      key: "issuerRut",
      status: validateRut(String(input.issuerRut ?? "")) ? "OK" : "MISSING",
      message: "RUT emisor debe tener formato chileno valido.",
    });
  }

  if (input.recipientRut !== undefined) {
    items.push({
      key: "recipientRut",
      status: validateRut(String(input.recipientRut ?? "")) ? "OK" : "MISSING",
      message: "RUT receptor de prueba debe tener formato chileno valido.",
    });
  }

  if (input.documentType !== undefined) {
    const documentType = String(input.documentType ?? "");
    items.push({
      key: "documentType",
      status: isSupportedDteDocumentType(documentType) ? "OK" : "MISSING",
      message: "Tipo DTE debe estar soportado por Citaya.",
    });
  }

  if (input.folio !== undefined) {
    const folio = Number(input.folio);
    items.push({
      key: "folio",
      status: Number.isInteger(folio) && folio > 0 ? "OK" : "MISSING",
      message: "Folio DTE debe ser numerico positivo.",
    });
  }

  for (const name of REQUIRED_CERTIFICATION_ENV) {
    const value = String(env[name] ?? "").trim();
    const missingInCertification = mode === "certification" && !value;
    items.push({
      key: name,
      status: missingInCertification ? "MISSING" : value ? "OK" : "WARNING",
      message: value
        ? `${name} configurado como ruta externa sin exponer contenido.`
        : `${name} pendiente; obligatorio solo en modo certification.`,
    });
  }

  for (const name of SECRET_ENV) {
    const value = String(env[name] ?? "").trim();
    if (!value) continue;
    if (isSecretPathSuspicious(value, repoRoot)) {
      items.push({
        key: name,
        status: "DANGEROUS",
        message:
          "Ruta de secreto sospechosa: debe ser absoluta y estar fuera de docs/, lib/, app/ y scripts/.",
      });
    }
  }

  return items;
}

export function assertSafeDteConfig(input: DteConfigValidationInput = {}): void {
  const items = validateDteConfig(input);
  const dangerous = items.filter((item) => item.status === "DANGEROUS");
  if (dangerous.length > 0) {
    throw new Error(
      `DTE configuration contains dangerous secret paths: ${dangerous
        .map((item) => item.key)
        .join(", ")}`,
    );
  }

  const mode = String(input.mode ?? input.env?.DTE_MODE ?? process.env.DTE_MODE ?? "lab");
  const missing = items.filter((item) => item.status === "MISSING");
  if (mode === "certification" && missing.length > 0) {
    throw new Error(
      `DTE certification configuration missing: ${missing
        .map((item) => item.key)
        .join(", ")}`,
    );
  }
}
