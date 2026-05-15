export const SII_ERROR_CODES = {
  ENDPOINT_MISSING: "SII_CERTIFICATION_ENDPOINT_MISSING",
  CERTIFICATE_MISSING: "SII_CERTIFICATE_MISSING",
  PRIVATE_KEY_MISSING: "SII_PRIVATE_KEY_MISSING",
  TOKEN_PENDING_REAL_CERTIFICATION: "SII_TOKEN_PENDING_REAL_CERTIFICATION",
  SUBMIT_PENDING_REAL_CERTIFICATION: "SII_SUBMIT_PENDING_REAL_CERTIFICATION",
  STATUS_PENDING_REAL_CERTIFICATION: "SII_STATUS_PENDING_REAL_CERTIFICATION",
  PRODUCTION_DISABLED: "DTE_PRODUCTION_DISABLED_UNTIL_SII_APPROVAL",
  INVALID_ENVIRONMENT: "SII_INVALID_ENVIRONMENT",
  INVALID_REQUEST: "SII_INVALID_REQUEST",
  INVALID_RESPONSE: "SII_INVALID_RESPONSE",
} as const;

export type SiiErrorCode =
  (typeof SII_ERROR_CODES)[keyof typeof SII_ERROR_CODES];

export class SiiCertificationError extends Error {
  code: SiiErrorCode;
  field?: string | null;

  constructor(code: SiiErrorCode, message: string, field?: string | null) {
    super(`${code}: ${message}`);
    this.name = "SiiCertificationError";
    this.code = code;
    this.field = field ?? null;
  }
}

export function toSiiCertificationError(error: unknown): SiiCertificationError {
  if (error instanceof SiiCertificationError) return error;
  if (error instanceof Error) {
    return new SiiCertificationError(SII_ERROR_CODES.INVALID_REQUEST, error.message);
  }
  return new SiiCertificationError(
    SII_ERROR_CODES.INVALID_REQUEST,
    "Error SII certification no estructurado",
  );
}

export function assertCertificationEnvironment(environment: string): void {
  if (environment === "production") {
    throw new SiiCertificationError(
      SII_ERROR_CODES.PRODUCTION_DISABLED,
      "Production DTE/SII esta bloqueado hasta aprobacion SII real y feature flag futuro.",
      "DTE_SII_ENV",
    );
  }

  if (environment !== "certification") {
    throw new SiiCertificationError(
      SII_ERROR_CODES.INVALID_ENVIRONMENT,
      "El cliente SII de este bloque solo permite ambiente certification.",
      "DTE_SII_ENV",
    );
  }
}

export function redactToken(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
