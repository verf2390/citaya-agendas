export type PaymentProviderId = "mercadopago" | "webpay" | "khipu" | "manual";

export type PaymentProviderConfig = {
  id: PaymentProviderId;
  enabled: boolean;
  credentials?: Record<string, string | null | undefined>;
};

export type CreateProviderPaymentParams = {
  appointmentId: string;
  tenantId: string;
  title: string;
  amount: number;
  currency: string;
  customerName?: string | null;
  customerEmail?: string | null;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  notificationUrl: string;
  config: PaymentProviderConfig;
};

export type ProviderPaymentResult = {
  provider: PaymentProviderId;
  reference: string | null;
  paymentUrl: string | null;
  redirectMethod?: "GET" | "POST";
  redirectPayload?: Record<string, string>;
  raw?: unknown;
};

export interface PaymentProvider {
  id: PaymentProviderId;
  createPayment(args: CreateProviderPaymentParams): Promise<ProviderPaymentResult>;
}
