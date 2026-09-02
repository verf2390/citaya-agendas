import { khipuProvider } from "@/services/payments/providers/khipu";
import { manualProvider } from "@/services/payments/providers/manual";
import { mercadoPagoProvider } from "@/services/payments/providers/mercadopago";
import type { TenantPaymentConfig } from "@/services/payments/payment-config";
import {
  getKhipuCredentials,
  getWebpayCredentials,
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
  tenantId: string,
  paymentConfig: TenantPaymentConfig,
): PaymentProviderConfig {
  const readiness = evaluateTenantPaymentReadiness(paymentConfig);
  const baseEnabled =
    paymentConfig.settingsFound &&
    paymentConfig.paymentMethodsValid &&
    paymentConfig.enabled &&
    paymentConfig.mode !== "none" &&
    paymentConfig.collectionMode !== "none" &&
    paymentConfig.paymentMethodsEnabled.includes(providerId);

  if (providerId === "mercadopago") {
    return {
      id: providerId,
      enabled: baseEnabled,
      configured: readiness.methods.mercadopago.configured,
      credentialSource: readiness.methods.mercadopago.configured
        ? "tenant"
        : undefined,
      credentials: {
        accessToken: paymentConfig.accessToken,
        publicKey: paymentConfig.publicKey,
      },
    };
  }

  if (providerId === "webpay") {
    const credentials = paymentConfig.settingsFound
      ? getWebpayCredentials(tenantId, {
          commerceCode: paymentConfig.webpayCommerceCode,
          apiKey: paymentConfig.webpayApiKey,
          environment: paymentConfig.webpayEnvironment as
            | "integration"
            | "production"
            | undefined,
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
      ? getKhipuCredentials(tenantId, {
          receiverId: paymentConfig.khipuReceiverId,
          apiKey: paymentConfig.khipuSecret,
          environment: paymentConfig.khipuEnvironment as
            | "development"
            | "production"
            | undefined,
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
