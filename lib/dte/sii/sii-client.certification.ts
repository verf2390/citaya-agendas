import type {
  SiiClientConfig,
  SiiEnvironment,
  SiiRejectReason,
  SiiSendResult,
  SiiTrackStatusResult,
} from "../types";

function envValue(name: string): string {
  return String(process.env[name] ?? "").trim();
}

export function getSiiClientConfigFromEnv(
  environment: SiiEnvironment = "certification",
): SiiClientConfig {
  return {
    environment,
    baseUrl:
      environment === "production"
        ? envValue("SII_PRODUCTION_BASE_URL")
        : envValue("SII_CERTIFICATION_BASE_URL"),
    rutEmpresa: envValue("SII_RUT_EMPRESA"),
    rutUsuario: envValue("SII_RUT_USUARIO"),
    timeoutMs: 30_000,
  };
}

function missingConfig(config: SiiClientConfig): SiiRejectReason[] {
  const errors: SiiRejectReason[] = [];
  if (!config.baseUrl) errors.push({ code: "missing_base_url", message: "Falta URL base SII" });
  if (!config.rutEmpresa) errors.push({ code: "missing_company_rut", message: "Falta SII_RUT_EMPRESA" });
  if (!config.rutUsuario) errors.push({ code: "missing_user_rut", message: "Falta SII_RUT_USUARIO" });
  return errors;
}

export async function getCertificationSeed(
  config: SiiClientConfig,
): Promise<{ ok: false; errors: SiiRejectReason[]; isProductionValid: false }> {
  return {
    ok: false,
    errors: [
      ...missingConfig(config),
      {
        code: "pending_official_endpoint",
        message: "getSeed certificacion pendiente de validar contra documentacion oficial SII",
      },
    ],
    isProductionValid: false,
  };
}

export async function getCertificationToken(
  config: SiiClientConfig,
): Promise<{ ok: false; errors: SiiRejectReason[]; isProductionValid: false }> {
  return {
    ok: false,
    errors: [
      ...missingConfig(config),
      {
        code: "pending_signed_seed",
        message: "getToken requiere semilla firmada con certificado controlado",
      },
    ],
    isProductionValid: false,
  };
}

export async function sendDteToSiiCertification(
  signedXml: string,
  config: SiiClientConfig,
): Promise<SiiSendResult> {
  const errors = missingConfig(config);
  if (!signedXml.trim()) {
    errors.push({ code: "missing_signed_xml", message: "Falta XML firmado" });
  }
  errors.push({
    code: "blocked_until_real_signature",
    message: "Envio bloqueado hasta tener XML firmado, TED/CAF real y XSD validado",
  });

  return {
    ok: false,
    environment: config.environment,
    trackId: null,
    status: "pending",
    errors,
    isProductionValid: false,
  };
}

export async function getSiiTrackStatusCertification(
  trackId: string,
  config: SiiClientConfig,
): Promise<SiiTrackStatusResult> {
  const errors = missingConfig(config);
  if (!trackId.trim()) {
    errors.push({ code: "missing_track_id", message: "Falta track_id" });
  }

  return {
    ok: false,
    environment: config.environment,
    trackId,
    siiStatus: "unknown",
    errors: [
      ...errors,
      {
        code: "pending_official_status_endpoint",
        message: "Consulta de estado pendiente de validar contra ambiente certificacion SII",
      },
    ],
    checkedAt: new Date().toISOString(),
    isProductionValid: false,
  };
}

