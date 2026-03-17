import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type PaymentMode = 'none' | 'optional' | 'required';
export type DepositType = 'fixed' | 'percentage' | null;

export interface TenantPaymentConfig {
  enabled: boolean;
  mode: PaymentMode;
  provider: 'mercadopago';
  publicKey?: string;
  accessToken?: string;
  depositType?: DepositType;
  depositValue?: number | null;
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
    };
  }

  return {
    enabled: data.active ?? false,
    mode: (data.payment_mode ?? 'none') as PaymentMode,
    provider: 'mercadopago',
    publicKey: data.mercadopago_public_key ?? undefined,
    accessToken: data.mercadopago_access_token ?? undefined,
    depositType: (data.deposit_type ?? null) as DepositType,
    depositValue:
      data.deposit_value !== null && data.deposit_value !== undefined
        ? Number(data.deposit_value)
        : null,
  };
}