export type KhipuCredentials = {
  apiKey: string;
  receiverId: string;
  environment: "development" | "production";
  source: "tenant";
};

export type WebpayCredentials = {
  commerceCode: string;
  apiKey: string;
  environment: "integration" | "production";
  source: "tenant";
};

type TenantKhipuCredentials = {
  apiKey?: unknown;
  receiverId?: unknown;
  environment?: unknown;
};

type TenantWebpayCredentials = {
  commerceCode?: unknown;
  apiKey?: unknown;
  environment?: unknown;
};

function khipuCredentials(
  value: TenantKhipuCredentials | undefined,
): KhipuCredentials | null {
  const apiKey = typeof value?.apiKey === "string" ? value.apiKey.trim() : "";
  const receiverId =
    typeof value?.receiverId === "string" ? value.receiverId.trim() : "";
  const environment =
    typeof value?.environment === "string" ? value.environment : "";
  if (
    !apiKey ||
    !receiverId ||
    (environment !== "development" && environment !== "production")
  ) {
    return null;
  }
  return { apiKey, receiverId, environment, source: "tenant" };
}

function webpayCredentials(
  value: TenantWebpayCredentials | undefined,
): WebpayCredentials | null {
  const commerceCode =
    typeof value?.commerceCode === "string" ? value.commerceCode.trim() : "";
  const apiKey = typeof value?.apiKey === "string" ? value.apiKey.trim() : "";
  const environment =
    typeof value?.environment === "string" ? value.environment : "";
  if (
    !commerceCode ||
    !apiKey ||
    (environment !== "integration" && environment !== "production")
  ) {
    return null;
  }
  return { commerceCode, apiKey, environment, source: "tenant" };
}

export function getTenantKhipuCredentials(
  tenantCredentials?: TenantKhipuCredentials,
): KhipuCredentials | null {
  return khipuCredentials(tenantCredentials);
}

export function getTenantWebpayCredentials(
  tenantCredentials?: TenantWebpayCredentials,
): WebpayCredentials | null {
  return webpayCredentials(tenantCredentials);
}
