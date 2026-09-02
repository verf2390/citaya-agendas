import {
  Environment,
  Options,
  WebpayPlus,
} from "transbank-sdk";

type KhipuCredentials = {
  apiKey: string;
  receiverId: string;
};

type WebpayCredentials = {
  commerceCode: string;
  apiKey: string;
  environment: "integration" | "production";
};

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

export function getKhipuCredentials(tenantId: string): KhipuCredentials | null {
  const mapped = credentialMap("CITAYA_KHIPU_CREDENTIALS_JSON")?.[tenantId];
  const apiKey = String(
    mapped?.apiKey ?? process.env.KHIPU_API_KEY ?? "",
  ).trim();
  const receiverId = String(
    mapped?.receiverId ?? process.env.KHIPU_RECEIVER_ID ?? "",
  ).trim();
  return apiKey && receiverId ? { apiKey, receiverId } : null;
}

export function getWebpayCredentials(tenantId: string): WebpayCredentials | null {
  const mapped = credentialMap("CITAYA_WEBPAY_CREDENTIALS_JSON")?.[tenantId];
  const commerceCode = String(
    mapped?.commerceCode ?? process.env.WEBPAY_COMMERCE_CODE ?? "",
  ).trim();
  const apiKey = String(
    mapped?.apiKey ?? process.env.WEBPAY_API_KEY ?? "",
  ).trim();
  const environment =
    String(
      mapped?.environment ?? process.env.WEBPAY_ENVIRONMENT ?? "integration",
    ).trim() === "production"
      ? "production"
      : "integration";
  return commerceCode && apiKey ? { commerceCode, apiKey, environment } : null;
}

export function webpayTransaction(credentials: WebpayCredentials) {
  const options = new Options(
    credentials.commerceCode,
    credentials.apiKey,
    credentials.environment === "production"
      ? Environment.Production
      : Environment.Integration,
  );
  return new WebpayPlus.Transaction(options);
}
