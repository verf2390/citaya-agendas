import type {
  PaymentProviderId,
  TenantPaymentConfig,
} from "@/services/payments/payment-config";

export type PaymentMethodReadiness = {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
};

export type TenantPaymentReadiness = {
  ready: boolean;
  methods: Record<PaymentProviderId, PaymentMethodReadiness>;
};

function present(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function validEnvironment(value: unknown, allowed: readonly string[]): boolean {
  return allowed.includes(String(value ?? "").trim());
}

export function evaluateTenantPaymentReadiness(
  config: TenantPaymentConfig,
): TenantPaymentReadiness {
  const enabled = new Set(config.paymentMethodsEnabled);
  const configured: Record<PaymentProviderId, boolean> = {
    manual: [
      config.bankName,
      config.bankAccountType,
      config.bankAccountNumber,
      config.bankAccountHolder,
      config.bankRut,
      config.bankEmail,
    ].every(present),
    mercadopago: present(config.accessToken),
    webpay:
      present(config.webpayCommerceCode) &&
      present(config.webpayApiKey) &&
      validEnvironment(config.webpayEnvironment, ["integration", "production"]),
    khipu:
      present(config.khipuReceiverId) &&
      present(config.khipuSecret) &&
      validEnvironment(config.khipuEnvironment, ["development", "production"]),
  };

  const methods = Object.fromEntries(
    (["mercadopago", "webpay", "khipu", "manual"] as const).map((method) => {
      const methodEnabled = enabled.has(method);
      return [
        method,
        {
          enabled: methodEnabled,
          configured: configured[method],
          ready: methodEnabled && configured[method],
        },
      ];
    }),
  ) as Record<PaymentProviderId, PaymentMethodReadiness>;

  const baseReady =
    config.settingsFound &&
    config.paymentMethodsValid &&
    config.enabled &&
    config.mode !== "none" &&
    config.collectionMode !== "none" &&
    enabled.size > 0;

  return {
    ready:
      baseReady &&
      [...enabled].every((method) => methods[method]?.configured === true),
    methods,
  };
}
