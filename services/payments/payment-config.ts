import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type PaymentMode = 'none' | 'optional' | 'required';
export type DepositType = 'fixed' | 'percentage' | null;
export type PaymentCollectionMode = 'none' | 'full' | 'deposit';
export type PaymentProviderId = 'mercadopago' | 'webpay' | 'khipu' | 'manual';

export interface TenantPaymentConfig {
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

function parsePaymentMethods(value: unknown): PaymentProviderId[] {
  const raw = Array.isArray(value) ? value : ['mercadopago'];
  const methods = raw.filter((item): item is PaymentProviderId =>
    PAYMENT_PROVIDERS.includes(item as PaymentProviderId),
  );

  return methods.length > 0 ? methods : ['mercadopago'];
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
  const { data, error } = await supabase
    .from('tenant_payment_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) {
    return {
      enabled: false,
      mode: 'none',
      provider: 'mercadopago',
      publicKey: undefined,
      accessToken: undefined,
      depositType: null,
      depositValue: null,
      paymentMethodsEnabled: ['mercadopago'],
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

  return {
    enabled: data.active ?? false,
    mode,
    provider: 'mercadopago',
    publicKey: data.mercadopago_public_key ?? undefined,
    accessToken: data.mercadopago_access_token ?? undefined,
    depositType: (data.deposit_type ?? null) as DepositType,
    depositValue:
      data.deposit_value !== null && data.deposit_value !== undefined
        ? Number(data.deposit_value)
        : null,
    paymentMethodsEnabled: parsePaymentMethods(data.payment_methods_enabled),
    collectionMode: parseCollectionMode(data.payment_collection_mode, mode),
    webpayCommerceCode: data.webpay_commerce_code ?? undefined,
    webpayApiKey: data.webpay_api_key ?? undefined,
    webpayEnvironment: data.webpay_environment ?? 'integration',
    khipuReceiverId: data.khipu_receiver_id ?? undefined,
    khipuSecret: data.khipu_secret ?? undefined,
    khipuEnvironment: data.khipu_environment ?? 'development',
    bankName: data.bank_name ?? undefined,
    bankAccountType: data.bank_account_type ?? undefined,
    bankAccountNumber: data.bank_account_number ?? undefined,
    bankAccountHolder: data.bank_account_holder ?? undefined,
    bankRut: data.bank_rut ?? undefined,
    bankEmail: data.bank_email ?? undefined,
  };
}
