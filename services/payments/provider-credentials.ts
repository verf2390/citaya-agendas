export type KhipuCredentials = {
  apiKey: string;
  receiverId: string;
  environment: "development" | "production";
  source: "tenant" | "tenant-map" | "global-env";
};

export type WebpayCredentials = {
  commerceCode: string;
  apiKey: string;
  environment: "integration" | "production";
  source: "tenant" | "tenant-map" | "global-env";
};

type TenantKhipuCredentials = Partial<
  Pick<KhipuCredentials, "apiKey" | "receiverId" | "environment">
>;

type TenantWebpayCredentials = Partial<
  Pick<WebpayCredentials, "commerceCode" | "apiKey" | "environment">
>;

function credentialMap(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, Record<string, unknown>>)
      : null;
  } catch {
    console.error("[payments/credentials] invalid JSON", { name });
    return null;
  }
}

function khipuCredentials(
  value: TenantKhipuCredentials | Record<string, unknown> | undefined,
  source: KhipuCredentials["source"],
): KhipuCredentials | null {
  const apiKey = String(value?.apiKey ?? "").trim();
  const receiverId = String(value?.receiverId ?? "").trim();
  const environment = String(value?.environment ?? "development").trim();
  if (
    !apiKey ||
    !receiverId ||
    (environment !== "development" && environment !== "production")
  ) {
    return null;
  }
  return { apiKey, receiverId, environment, source };
}

function webpayCredentials(
  value: TenantWebpayCredentials | Record<string, unknown> | undefined,
  source: WebpayCredentials["source"],
): WebpayCredentials | null {
  const commerceCode = String(value?.commerceCode ?? "").trim();
  const apiKey = String(value?.apiKey ?? "").trim();
  const environment = String(value?.environment ?? "integration").trim();
  if (
    !commerceCode ||
    !apiKey ||
    (environment !== "integration" && environment !== "production")
  ) {
    return null;
  }
  return { commerceCode, apiKey, environment, source };
}

export function getKhipuCredentials(
  tenantId: string,
  tenantCredentials?: TenantKhipuCredentials,
): KhipuCredentials | null {
  const hasTenantMaterial = Boolean(
    String(tenantCredentials?.apiKey ?? "").trim() ||
      String(tenantCredentials?.receiverId ?? "").trim(),
  );
  if (hasTenantMaterial) {
    return khipuCredentials(tenantCredentials, "tenant");
  }

  const mapped = credentialMap("CITAYA_KHIPU_CREDENTIALS_JSON")?.[tenantId];
  if (mapped) return khipuCredentials(mapped, "tenant-map");

  return khipuCredentials(
    {
      apiKey: process.env.KHIPU_API_KEY,
      receiverId: process.env.KHIPU_RECEIVER_ID,
      environment: process.env.KHIPU_ENVIRONMENT,
    },
    "global-env",
  );
}

export function getWebpayCredentials(
  tenantId: string,
  tenantCredentials?: TenantWebpayCredentials,
): WebpayCredentials | null {
  const hasTenantMaterial = Boolean(
    String(tenantCredentials?.commerceCode ?? "").trim() ||
      String(tenantCredentials?.apiKey ?? "").trim(),
  );
  if (hasTenantMaterial) {
    return webpayCredentials(tenantCredentials, "tenant");
  }

  const mapped = credentialMap("CITAYA_WEBPAY_CREDENTIALS_JSON")?.[tenantId];
  if (mapped) return webpayCredentials(mapped, "tenant-map");

  return webpayCredentials(
    {
      commerceCode: process.env.WEBPAY_COMMERCE_CODE,
      apiKey: process.env.WEBPAY_API_KEY,
      environment: process.env.WEBPAY_ENVIRONMENT,
    },
    "global-env",
  );
}
