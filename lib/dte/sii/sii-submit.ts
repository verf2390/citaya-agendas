import { existsSync } from "node:fs";

import { validateRut } from "../rut";
import { SII_ERROR_CODES, SiiCertificationError, assertCertificationEnvironment } from "./sii-errors";
import { parseSiiSubmissionResponse } from "./sii-status";
import type {
  SiiCertificationConfig,
  SiiSubmitCertificationResult,
} from "./sii-types";

function now(): string {
  return new Date().toISOString();
}

function withTimeout(config: SiiCertificationConfig, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    signal: AbortSignal.timeout(config.timeoutMs || 30_000),
  };
}

export type SubmitCertificationSetOptions = {
  xml: string;
  xmlPath?: string | null;
  xsdValidated: boolean;
  token?: string | null;
  issuerRut: string;
  companyRut: string;
  fileName: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
};

export function validateSubmitCertificationSet(
  config: SiiCertificationConfig,
  options: SubmitCertificationSetOptions,
): void {
  assertCertificationEnvironment(config.environment);
  if (!config.submitUrl.trim()) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.ENDPOINT_MISSING,
      "Falta endpoint submit SII certification.",
      "DTE_SII_SUBMIT_URL",
    );
  }
  if (!options.xml.trim()) {
    throw new SiiCertificationError(SII_ERROR_CODES.INVALID_REQUEST, "XML EnvioDTE vacio.", "xml");
  }
  if (options.xmlPath && !existsSync(options.xmlPath)) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "Archivo XML EnvioDTE no existe.",
      "xmlPath",
    );
  }
  if (!options.xsdValidated) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "No se permite submit sin validacion XSD previa.",
      "xsdValidated",
    );
  }
  if (!validateRut(options.issuerRut) || !validateRut(options.companyRut)) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_REQUEST,
      "RUT emisor/empresa invalido para submit SII.",
      "rut",
    );
  }
  if (!options.token?.trim()) {
    throw new SiiCertificationError(SII_ERROR_CODES.INVALID_REQUEST, "Token SII requerido.", "token");
  }
}

export async function submitCertificationSet(
  config: SiiCertificationConfig,
  options: SubmitCertificationSetOptions,
): Promise<SiiSubmitCertificationResult> {
  validateSubmitCertificationSet(config, options);

  if (options.dryRun || !config.enableSubmit) {
    throw new SiiCertificationError(
      SII_ERROR_CODES.SUBMIT_PENDING_REAL_CERTIFICATION,
      "Submit real bloqueado: usar DTE_SII_ENABLE_SUBMIT=true solo con credenciales reales de certification.",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(config.submitUrl, withTimeout(config, {
    method: "POST",
    headers: {
      "content-type": "application/xml; charset=ISO-8859-1",
      cookie: `TOKEN=${options.token}`,
    },
    body: options.xml,
  }));
  const raw = await response.text();
  const parsed = parseSiiSubmissionResponse(raw);

  return {
    ok: response.ok && Boolean(parsed.trackId),
    trackId: parsed.trackId,
    rawStatus: parsed.rawStatus,
    internalStatus: parsed.internalStatus,
    siiStatus: parsed.status,
    message: parsed.message ?? "Respuesta submit SII recibida.",
    submittedAt: now(),
    environment: "certification",
  };
}
