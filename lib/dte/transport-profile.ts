export type DteEnvironment = "certification" | "production";
export type PrimaryDteType = 33 | 39;

export type DteTransportProfile = {
  environment: DteEnvironment;
  dteType: PrimaryDteType;
  endpointFamily: "legacy_dte_upload" | "boleta_rest";
  endpoint: string;
  tokenScope: "factura" | "boleta";
  enabled: boolean;
};

function requiredUrl(value: unknown, code: string): string {
  const text = String(value ?? "").trim();
  if (!/^https:\/\//.test(text)) throw new Error(code);
  return text;
}

/**
 * Token material never enters this value object. Type 39 deliberately uses
 * separate endpoint variables and remains disabled unless its own capability
 * has been authorized.
 */
export function resolveDteTransportProfile(input: {
  environment: DteEnvironment;
  dteType: PrimaryDteType;
  env?: NodeJS.ProcessEnv;
  type39IssuanceEnabled?: boolean;
}): DteTransportProfile {
  const env = input.env ?? process.env;
  if (input.dteType === 39) {
    return {
      environment: input.environment,
      dteType: 39,
      endpointFamily: "boleta_rest",
      endpoint: requiredUrl(
        input.environment === "production"
          ? env.DTE_BOLETA_PRODUCTION_UPLOAD_URL
          : env.DTE_BOLETA_CERTIFICATION_UPLOAD_URL,
        "DTE_BOLETA_ENDPOINT_MISSING",
      ),
      tokenScope: "boleta",
      enabled: input.type39IssuanceEnabled === true,
    };
  }
  return {
    environment: input.environment,
    dteType: 33,
    endpointFamily: "legacy_dte_upload",
    endpoint: requiredUrl(
      input.environment === "production"
        ? env.DTE_SII_PRODUCTION_UPLOAD_URL
        : env.DTE_SII_CERTIFICATION_UPLOAD_URL,
      "DTE_FACTURA_ENDPOINT_MISSING",
    ),
    tokenScope: "factura",
    enabled: true,
  };
}
