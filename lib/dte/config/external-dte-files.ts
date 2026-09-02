import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

import { isPathInsideRepo } from "./validate-dte-config";

export type ExternalDteFileStatus =
  | "ready"
  | "pending_config"
  | "missing_external_file"
  | "unsafe_repo_path"
  | "unsupported_certificate_format"
  | "failed";

export type ExternalDteFileValidation = {
  ok: boolean;
  status: ExternalDteFileStatus;
  pathConfigured: boolean;
  exists: boolean;
  outsideRepo: boolean;
  error?: string;
};

export type ExternalDteFileInput = {
  envName: string;
  pathValue?: string | null;
  repoRoot?: string;
  allowedExtensions?: string[];
  required?: boolean;
};

function normalizeExtensions(extensions: string[] = []): string[] {
  return extensions.map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function validateExternalDteFile(
  input: ExternalDteFileInput,
): ExternalDteFileValidation {
  const repoRoot = input.repoRoot ?? process.cwd();
  const pathValue = String(input.pathValue ?? process.env[input.envName] ?? "").trim();
  const required = input.required ?? true;

  if (!pathValue) {
    return {
      ok: !required,
      status: required ? "pending_config" : "ready",
      pathConfigured: false,
      exists: false,
      outsideRepo: false,
      error: required ? `${input.envName} no configurado. Ver docs/dte-sii/EXTERNAL_DTE_FILES_SETUP.md. No se genero XML y no se contacto SII.` : undefined,
    };
  }

  const exists = existsSync(pathValue);

  if (!isAbsolute(pathValue)) {
    return {
      ok: false,
      status: "unsafe_repo_path",
      pathConfigured: true,
      exists,
      outsideRepo: false,
      error: `${input.envName} debe apuntar a una ruta absoluta externa al repo. Ver docs/dte-sii/EXTERNAL_DTE_FILES_SETUP.md. No se genero XML y no se contacto SII.`,
    };
  }

  const outsideRepo = !isPathInsideRepo(pathValue, repoRoot);

  if (!outsideRepo) {
    return {
      ok: false,
      status: "unsafe_repo_path",
      pathConfigured: true,
      exists,
      outsideRepo: false,
      error: `${input.envName} debe apuntar a una ruta absoluta externa al repo. Ver docs/dte-sii/EXTERNAL_DTE_FILES_SETUP.md. No se genero XML y no se contacto SII.`,
    };
  }

  if (!exists) {
    return {
      ok: false,
      status: "missing_external_file",
      pathConfigured: true,
      exists: false,
      outsideRepo: true,
      error: `${input.envName} apunta a un archivo externo no encontrado. Ver docs/dte-sii/EXTERNAL_DTE_FILES_SETUP.md. No se genero XML y no se contacto SII.`,
    };
  }

  try {
    const stat = statSync(pathValue);
    if (!stat.isFile()) {
      return {
        ok: false,
        status: "failed",
        pathConfigured: true,
        exists: true,
        outsideRepo: true,
        error: `${input.envName} debe ser un archivo regular externo. No se genero XML y no se contacto SII.`,
      };
    }
  } catch {
    return {
      ok: false,
      status: "failed",
      pathConfigured: true,
      exists: true,
      outsideRepo: true,
      error: `${input.envName} no pudo validarse como archivo externo. No se genero XML y no se contacto SII.`,
    };
  }

  const allowed = normalizeExtensions(input.allowedExtensions);
  const extension = extname(resolve(pathValue)).toLowerCase();
  if (allowed.length > 0 && !allowed.includes(extension)) {
    return {
      ok: false,
      status: "unsupported_certificate_format",
      pathConfigured: true,
      exists: true,
      outsideRepo: true,
      error: `${input.envName} tiene extension no soportada para este flujo. Ver docs/dte-sii/EXTERNAL_DTE_FILES_SETUP.md. No se genero XML y no se contacto SII.`,
    };
  }

  return {
    ok: true,
    status: "ready",
    pathConfigured: true,
    exists: true,
    outsideRepo: true,
  };
}

export function assertExternalDteFileReady(input: ExternalDteFileInput): string {
  const pathValue = String(input.pathValue ?? process.env[input.envName] ?? "").trim();
  const result = validateExternalDteFile(input);
  if (!result.ok) {
    throw new Error(result.error ?? `${input.envName} no esta listo: ${result.status}`);
  }
  return pathValue;
}
