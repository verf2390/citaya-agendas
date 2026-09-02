export type PaymentProviderId = "mercadopago" | "webpay" | "khipu" | "manual";

export type PaymentProviderConfig = {
  id: PaymentProviderId;
  enabled: boolean;
  configured: boolean;
  credentialSource?: "tenant" | "tenant-map" | "global-env";
  credentials?: Record<string, string | null | undefined>;
};

export type CreateProviderPaymentParams = {
  paymentIntentId: string;
  appointmentId: string;
  tenantId: string;
  buyOrder?: string | null;
  sessionId?: string | null;
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
};

export interface PaymentProvider {
  id: PaymentProviderId;
  createPayment(args: CreateProviderPaymentParams): Promise<ProviderPaymentResult>;
}
