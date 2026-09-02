export type TenantCredentialUpdates = {
  mercadopago_public_key?: string;
  mercadopago_access_token?: string;
  webpay_commerce_code?: string;
  webpay_api_key?: string;
  khipu_receiver_id?: string;
  khipu_secret?: string;
};

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
): TenantCredentialUpdates {
  if (typeof body !== "object" || body === null) return {};

  const input = body as Record<string, unknown>;
  const updates: TenantCredentialUpdates = {};
  for (const [requestField, databaseField] of CREDENTIAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, requestField)) continue;
    const value = String(input[requestField] ?? "").trim();
    if (value) updates[databaseField] = value;
  }
  return updates;
}
