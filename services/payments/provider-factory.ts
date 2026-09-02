import { khipuProvider } from "@/services/payments/providers/khipu";
import { manualProvider } from "@/services/payments/providers/manual";
import { mercadoPagoProvider } from "@/services/payments/providers/mercadopago";
import type {
  PaymentProvider,
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

export function isPaymentProviderId(value: unknown): value is PaymentProviderId {
  return (
    value === "mercadopago" ||
    value === "webpay" ||
    value === "khipu" ||
    value === "manual"
  );
}
