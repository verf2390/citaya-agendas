import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

import { validateExternalDteFile } from "../config/external-dte-files";
import type { FrmtSignatureInput, FrmtSignatureResult } from "../types";
import { wrapBase64Lines } from "../signing/sign-xml.real";
import { buildOfficialFrmtDd } from "./ted-builder";

function readPrivateKey(input: FrmtSignatureInput): {
  key: string | null;
  status?: "missing_secret" | "unsafe_repo_path" | "failed";
  error?: string;
} {
  if (input.privateKeyPem?.trim()) return { key: input.privateKeyPem };
  const validation = validateExternalDteFile({
    envName: "DTE_CAF_PRIVATE_KEY_PATH",
    pathValue: input.privateKeyPath,
    allowedExtensions: [".pem", ".key"],
  });
  if (!validation.ok) {
    return {
      key: null,
      status:
        validation.status === "unsafe_repo_path"
          ? "unsafe_repo_path"
          : validation.status === "failed"
            ? "failed"
            : "missing_secret",
      error: validation.error,
    };
  }
  return { key: readFileSync(String(input.privateKeyPath), "utf8") };
}

export function signFrmtControlled(
  input: FrmtSignatureInput,
): FrmtSignatureResult {
  const missing: string[] = [];
  const keyResult = readPrivateKey(input);

  if (!input.ddXml.trim()) missing.push("ddXml");
  if (!keyResult.key) missing.push("DTE_CAF_PRIVATE_KEY_PATH");

  if (missing.length > 0) {
    return {
      ok: false,
      status: keyResult.status ?? "missing_secret",
      mode: input.mode,
      isProductionValid: false,
      missing,
      warnings: [
        keyResult.error ?? "FRMT real requiere clave privada asociada al CAF fuera del repositorio.",
        "No se genero FRMT productivo ni se usaron secretos.",
      ],
    };
  }

  if (!keyResult.key) {
    throw new Error("FRMT private key unexpectedly missing after validation");
  }

  const privateKey: string = keyResult.key;

  if (input.mode !== "certification" && input.mode !== "production") {
    return {
      ok: false,
      status: "blocked",
      mode: input.mode,
      isProductionValid: false,
      missing: [],
      warnings: [
        "FRMT real bloqueado fuera de modos certification/production controlados.",
        "No usar claves reales en modo lab/xsd-structure.",
      ],
    };
  }

  let signature: string;
  try {
    const signer = createSign("RSA-SHA1");
    signer.update(Buffer.from(buildOfficialFrmtDd(input.ddXml), "latin1"));
    signature = signer.sign(privateKey, "base64");
  } catch {
    return {
      ok: false,
      status: "failed",
      mode: input.mode,
      isProductionValid: false,
      missing: [],
      warnings: [
        "FRMT no pudo firmarse con la clave CAF externa; revisar formato PEM y correspondencia con CAF.",
        "No se imprimio ni persistio la clave privada.",
      ],
    };
  }

  return {
    ok: true,
    frmtXml: `<FRMT algoritmo="SHA1withRSA">${wrapBase64Lines(signature)}</FRMT>`,
    mode: input.mode,
    isProductionValid: input.mode === "production",
    warnings: [
      input.mode === "production" ? "FRMT productivo generado con CAF oficial validado." : "FRMT generado en modo certification controlado.",
    ],
  };
}
