import { khipuProvider } from "@/services/payments/providers/khipu";
import { manualProvider } from "@/services/payments/providers/manual";
import { mercadoPagoProvider } from "@/services/payments/providers/mercadopago";
import type { TenantPaymentConfig } from "@/services/payments/payment-config";
import {
  getTenantKhipuCredentials,
  getTenantWebpayCredentials,
} from "@/services/payments/provider-credentials";
import { evaluateTenantPaymentReadiness } from "@/services/payments/provider-readiness";
import type {
  PaymentProvider,
  PaymentProviderConfig,
  PaymentProviderId,
} from "@/services/payments/providers/types";
import { webpayProvider } from "@/services/payments/providers/webpay";

const providers: Record<PaymentProviderId, PaymentProvider> = {
  mercadopago: mercadoPagoProvider,
  webpay: webpayProvider,
  khipu: khipuProvider,
  manual: manualProvider,
};

export function getPaymentProvider(providerId: PaymentProviderId) {
  return providers[providerId];
}

export function getPaymentProviderConfig(
  providerId: PaymentProviderId,
  paymentConfig: TenantPaymentConfig,
): PaymentProviderConfig {
  const readiness = evaluateTenantPaymentReadiness(paymentConfig);
  const baseEnabled =
    readiness.ready && readiness.methods[providerId].enabled;

  if (providerId === "mercadopago") {
    return {
      id: providerId,
      enabled: baseEnabled,
      configured: readiness.methods.mercadopago.configured,
      credentialSource: readiness.methods.mercadopago.configured
        ? "tenant"
        : undefined,
      credentials: readiness.methods.mercadopago.configured
        ? {
            accessToken: paymentConfig.accessToken,
            publicKey: paymentConfig.publicKey,
          }
        : undefined,
    };
  }

  if (providerId === "webpay") {
    const credentials = paymentConfig.settingsFound
      ? getTenantWebpayCredentials({
          commerceCode: paymentConfig.webpayCommerceCode,
          apiKey: paymentConfig.webpayApiKey,
          environment: paymentConfig.webpayEnvironment,
        })
      : null;
    return {
      id: providerId,
      enabled: baseEnabled,
      configured: credentials !== null,
      credentialSource: credentials?.source,
      credentials: credentials
        ? {
            commerceCode: credentials.commerceCode,
            apiKey: credentials.apiKey,
            environment: credentials.environment,
          }
        : undefined,
    };
  }

  if (providerId === "khipu") {
    const credentials = paymentConfig.settingsFound
      ? getTenantKhipuCredentials({
          receiverId: paymentConfig.khipuReceiverId,
          apiKey: paymentConfig.khipuSecret,
          environment: paymentConfig.khipuEnvironment,
        })
      : null;
    return {
      id: providerId,
      enabled: baseEnabled,
      configured: credentials !== null,
      credentialSource: credentials?.source,
      credentials: credentials
        ? {
            receiverId: credentials.receiverId,
            apiKey: credentials.apiKey,
            environment: credentials.environment,
          }
        : undefined,
    };
  }

  return {
    id: providerId,
    enabled: baseEnabled,
    configured: readiness.methods.manual.configured,
  };
}

export function isPaymentProviderId(value: unknown): value is PaymentProviderId {
  return (
    value === "mercadopago" ||
    value === "webpay" ||
    value === "khipu" ||
    value === "manual"
  );
}
