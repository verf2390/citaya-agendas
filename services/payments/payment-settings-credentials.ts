export type TenantCredentialUpdates = {
  mercadopago_public_key?: string;
  mercadopago_access_token?: string;
  webpay_commerce_code?: string;
  webpay_api_key?: string;
  khipu_receiver_id?: string;
  khipu_secret?: string;
};

export type TenantCredentialUpdateResult =
  | { ok: true; updates: TenantCredentialUpdates }
  | { ok: false; status: 400; error: "Credenciales inválidas" };

const CREDENTIAL_FIELDS = [
  ["mercadopagoPublicKey", "mercadopago_public_key"],
  ["mercadopagoAccessToken", "mercadopago_access_token"],
  ["webpayCommerceCode", "webpay_commerce_code"],
  ["webpayApiKey", "webpay_api_key"],
  ["khipuReceiverId", "khipu_receiver_id"],
  ["khipuSecret", "khipu_secret"],
] as const;

export function tenantCredentialUpdates(
  body: unknown,
): TenantCredentialUpdateResult {
  if (typeof body !== "object" || body === null) {
    return { ok: true, updates: {} };
  }

  const input = body as Record<string, unknown>;
  const updates: TenantCredentialUpdates = {};
  for (const [requestField, databaseField] of CREDENTIAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, requestField)) continue;
    const rawValue = input[requestField];
    if (rawValue !== null && rawValue !== undefined && typeof rawValue !== "string") {
      return { ok: false, status: 400, error: "Credenciales inválidas" };
    }
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (value) updates[databaseField] = value;
  }
  return { ok: true, updates };
}
