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

export type ManualBankUpdates = {
  bank_name?: string | null;
  bank_account_type?: string | null;
  bank_account_number?: string | null;
  bank_account_holder?: string | null;
  bank_rut?: string | null;
  bank_email?: string | null;
};

export type ManualBankUpdateResult =
  | { ok: true; updates: ManualBankUpdates }
  | { ok: false; status: 400; error: "Datos bancarios inválidos" };

type ManualBankDetails = Pick<
  TenantPaymentConfig,
  | "bankName"
  | "bankAccountType"
  | "bankAccountNumber"
  | "bankAccountHolder"
  | "bankRut"
  | "bankEmail"
>;

const MANUAL_BANK_FIELDS = [
  ["bankName", "bank_name", 2, 120],
  ["bankAccountType", "bank_account_type", 2, 80],
  ["bankAccountNumber", "bank_account_number", 3, 80],
  ["bankAccountHolder", "bank_account_holder", 2, 180],
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function boundedText(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.trim().length <= maximum
  );
}

function normalizedChileanRut(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\./g, "").replace(/\s/g, "").toUpperCase();
  const match = cleaned.match(/^(\d{7,8})-?([0-9K])$/);
  if (!match) return null;

  const [, body, suppliedDv] = match;
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expectedDv =
    remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return suppliedDv === expectedDv ? `${Number(body)}-${suppliedDv}` : null;
}

function validBankEmail(value: unknown): boolean {
  return (
    boundedText(value, 3, 254) && EMAIL_PATTERN.test((value as string).trim())
  );
}

export function manualBankDetailsConfigured(
  details: ManualBankDetails,
): boolean {
  return (
    boundedText(details.bankName, 2, 120) &&
    boundedText(details.bankAccountType, 2, 80) &&
    boundedText(details.bankAccountNumber, 3, 80) &&
    boundedText(details.bankAccountHolder, 2, 180) &&
    normalizedChileanRut(details.bankRut) !== null &&
    validBankEmail(details.bankEmail)
  );
}

export function tenantManualBankUpdates(
  body: unknown,
  options: { allowDemoPlaceholder?: boolean } = {},
): ManualBankUpdateResult {
  if (typeof body !== "object" || body === null) {
    return { ok: true, updates: {} };
  }

  const input = body as Record<string, unknown>;
  const updates: ManualBankUpdates = {};
  for (const [requestField, databaseField, minimum, maximum] of MANUAL_BANK_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, requestField)) continue;
    const rawValue = input[requestField];
    if (rawValue === null) {
      updates[databaseField] = null;
      continue;
    }
    if (typeof rawValue !== "string") {
      return { ok: false, status: 400, error: "Datos bancarios inválidos" };
    }
    const value = rawValue.trim();
    if (!value) {
      updates[databaseField] = null;
      continue;
    }
    if (!boundedText(value, minimum, maximum)) {
      return { ok: false, status: 400, error: "Datos bancarios inválidos" };
    }
    updates[databaseField] = value;
  }

  if (Object.prototype.hasOwnProperty.call(input, "bankRut")) {
    const rawValue = input.bankRut;
    if (rawValue === null || rawValue === "" || rawValue === undefined) {
      updates.bank_rut = null;
    } else if (typeof rawValue !== "string") {
      return { ok: false, status: 400, error: "Datos bancarios inválidos" };
    } else if (!rawValue.trim()) {
      updates.bank_rut = null;
    } else if (
      options.allowDemoPlaceholder === true &&
      rawValue.trim() === "00.000.000-0"
    ) {
      updates.bank_rut = rawValue.trim();
    } else {
      const rut = normalizedChileanRut(rawValue);
      if (!rut) {
        return { ok: false, status: 400, error: "Datos bancarios inválidos" };
      }
      updates.bank_rut = rut;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "bankEmail")) {
    const rawValue = input.bankEmail;
    if (rawValue === null || rawValue === "" || rawValue === undefined) {
      updates.bank_email = null;
    } else if (typeof rawValue !== "string") {
      return { ok: false, status: 400, error: "Datos bancarios inválidos" };
    } else if (!rawValue.trim()) {
      updates.bank_email = null;
    } else if (!validBankEmail(rawValue)) {
      return { ok: false, status: 400, error: "Datos bancarios inválidos" };
    } else {
      updates.bank_email = rawValue.trim();
    }
  }

  return { ok: true, updates };
}

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
    manual: settingsFound && manualBankDetailsConfigured(config),
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
