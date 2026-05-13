import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import type { FrmtSignatureInput, FrmtSignatureResult } from "../types";

function readPrivateKey(input: FrmtSignatureInput): string | null {
  if (input.privateKeyPem?.trim()) return input.privateKeyPem;
  if (input.privateKeyPath?.trim() && existsSync(input.privateKeyPath)) {
    return readFileSync(input.privateKeyPath, "utf8");
  }
  return null;
}

export function signFrmtControlled(
  input: FrmtSignatureInput,
): FrmtSignatureResult {
  const missing: string[] = [];
  const key = readPrivateKey(input);

  if (!input.ddXml.trim()) missing.push("ddXml");
  if (!key) missing.push("DTE_CAF_PRIVATE_KEY_PATH");

  if (missing.length > 0) {
    return {
      ok: false,
      status: "missing_secret",
      mode: input.mode,
      isProductionValid: false,
      missing,
      warnings: [
        "FRMT real requiere clave privada asociada al CAF fuera del repositorio.",
        "No se genero FRMT productivo ni se usaron secretos.",
      ],
    };
  }

  if (!key) {
    throw new Error("FRMT private key unexpectedly missing after validation");
  }

  const privateKey: string = key;

  if (input.mode !== "certification") {
    return {
      ok: false,
      status: "blocked",
      mode: input.mode,
      isProductionValid: false,
      missing: [],
      warnings: [
        "FRMT real bloqueado fuera de modo certification controlado.",
        "No usar claves reales en modo lab/xsd-structure/production sin aprobacion explicita.",
      ],
    };
  }

  const signer = createSign("RSA-SHA1");
  signer.update(input.ddXml, "utf8");
  const signature = signer.sign(privateKey, "base64");

  return {
    ok: true,
    frmtXml: `<FRMT algoritmo="SHA1withRSA">${signature}</FRMT>`,
    mode: "certification",
    isProductionValid: false,
    warnings: [
      "FRMT generado en modo certification controlado. Sigue pendiente validar con CAF real y ambiente SII.",
    ],
  };
}
