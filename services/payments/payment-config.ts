import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type PaymentMode = 'none' | 'optional' | 'required';
export type DepositType = 'fixed' | 'percentage' | null;
export type PaymentCollectionMode = 'none' | 'full' | 'deposit';
export type PaymentProviderId = 'mercadopago' | 'webpay' | 'khipu' | 'manual';

export interface TenantPaymentConfig {
  settingsFound: boolean;
  paymentMethodsValid: boolean;
  enabled: boolean;
  mode: PaymentMode;
  provider: 'mercadopago';
  publicKey?: string;
  accessToken?: string;
  depositType?: DepositType;
  depositValue?: number | null;
  paymentMethodsEnabled: PaymentProviderId[];
  collectionMode: PaymentCollectionMode;
  webpayCommerceCode?: string;
  webpayApiKey?: string;
  webpayEnvironment?: string;
  khipuReceiverId?: string;
  khipuSecret?: string;
  khipuEnvironment?: string;
  bankName?: string;
  bankAccountType?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  bankRut?: string;
  bankEmail?: string;
}

const PAYMENT_PROVIDERS: PaymentProviderId[] = [
  'mercadopago',
  'webpay',
  'khipu',
  'manual',
];

function parsePaymentMethods(value: unknown): {
  methods: PaymentProviderId[];
  valid: boolean;
} {
  if (!Array.isArray(value)) return { methods: [], valid: false };

  const methods = value.filter((item): item is PaymentProviderId =>
    PAYMENT_PROVIDERS.includes(item as PaymentProviderId),
  );
  return {
    methods: [...new Set(methods)],
    valid: methods.length === value.length,
  };
}

function optionalText(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function parseCollectionMode(value: unknown, legacyMode: PaymentMode): PaymentCollectionMode {
  if (value === 'none' || value === 'full' || value === 'deposit') {
    return value;
  }

  return legacyMode === 'none' ? 'none' : 'full';
}

export async function getTenantPaymentConfig(
  tenantId: string
): Promise<TenantPaymentConfig> {
  const { data, error } = await supabaseAdmin
    .from('tenant_payment_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) {
    return {
      settingsFound: false,
      paymentMethodsValid: false,
      enabled: false,
      mode: 'none',
      provider: 'mercadopago',
      publicKey: undefined,
      accessToken: undefined,
      depositType: null,
      depositValue: null,
      paymentMethodsEnabled: [],
      collectionMode: 'none',
      webpayCommerceCode: undefined,
      webpayApiKey: undefined,
      webpayEnvironment: 'integration',
      khipuReceiverId: undefined,
      khipuSecret: undefined,
      khipuEnvironment: 'development',
      bankName: undefined,
      bankAccountType: undefined,
      bankAccountNumber: undefined,
      bankAccountHolder: undefined,
      bankRut: undefined,
      bankEmail: undefined,
    };
  }

  const mode = (data.payment_mode ?? 'none') as PaymentMode;
  const parsedMethods = parsePaymentMethods(data.payment_methods_enabled);

  return {
    settingsFound: true,
    paymentMethodsValid: parsedMethods.valid,
    enabled: data.active ?? false,
    mode,
    provider: 'mercadopago',
    publicKey: optionalText(data.mercadopago_public_key),
    accessToken: optionalText(data.mercadopago_access_token),
    depositType: (data.deposit_type ?? null) as DepositType,
    depositValue:
      data.deposit_value !== null && data.deposit_value !== undefined
        ? Number(data.deposit_value)
        : null,
    paymentMethodsEnabled: parsedMethods.methods,
    collectionMode: parseCollectionMode(data.payment_collection_mode, mode),
    webpayCommerceCode: optionalText(data.webpay_commerce_code),
    webpayApiKey: optionalText(data.webpay_api_key),
    webpayEnvironment: optionalText(data.webpay_environment) ?? 'integration',
    khipuReceiverId: optionalText(data.khipu_receiver_id),
    khipuSecret: optionalText(data.khipu_secret),
    khipuEnvironment: optionalText(data.khipu_environment) ?? 'development',
    bankName: optionalText(data.bank_name),
    bankAccountType: optionalText(data.bank_account_type),
    bankAccountNumber: optionalText(data.bank_account_number),
    bankAccountHolder: optionalText(data.bank_account_holder),
    bankRut: optionalText(data.bank_rut),
    bankEmail: optionalText(data.bank_email),
  };
}
