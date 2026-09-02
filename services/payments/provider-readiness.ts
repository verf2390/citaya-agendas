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
  return typeof value === "string" && value.trim().length > 0;
}

function validEnvironment(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

export function evaluateTenantPaymentReadiness(
  config: TenantPaymentConfig,
): TenantPaymentReadiness {
  const settingsFound = config.settingsFound === true;
  const enabled = new Set(
    Array.isArray(config.paymentMethodsEnabled)
      ? config.paymentMethodsEnabled
      : [],
  );
  const configured: Record<PaymentProviderId, boolean> = {
    manual:
      settingsFound &&
      [
        config.bankName,
        config.bankAccountType,
        config.bankAccountNumber,
        config.bankAccountHolder,
        config.bankRut,
        config.bankEmail,
      ].every(present),
    mercadopago: settingsFound && present(config.accessToken),
    webpay:
      settingsFound &&
      present(config.webpayCommerceCode) &&
      present(config.webpayApiKey) &&
      validEnvironment(config.webpayEnvironment, ["integration", "production"]),
    khipu:
      settingsFound &&
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
    settingsFound &&
    config.paymentMethodsValid === true &&
    config.enabled === true &&
    (config.mode === "optional" || config.mode === "required") &&
    (config.collectionMode === "full" || config.collectionMode === "deposit") &&
    enabled.size > 0;

  return {
    ready:
      baseReady &&
      [...enabled].every((method) => methods[method]?.configured === true),
    methods,
  };
}
