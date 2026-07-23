import type {
  CreateProviderPaymentParams,
  PaymentProvider,
} from "@/services/payments/providers/types";
import {
  getWebpayCredentials,
  webpayTransaction,
} from "@/services/payments/provider-credentials";

export const webpayProvider: PaymentProvider = {
  id: "webpay",
  async createPayment(args: CreateProviderPaymentParams) {
    const credentials = getWebpayCredentials(args.tenantId);
    if (!credentials) {
      throw new Error("Faltan credenciales de Webpay");
    }
    const buyOrder = String(args.buyOrder ?? "").trim();
    const sessionId = String(args.sessionId ?? "").trim();
    if (!buyOrder || !sessionId) {
      throw new Error("Falta vínculo interno de Webpay");
    }
    const response = await webpayTransaction(credentials).create(
      buyOrder,
      sessionId,
      args.amount,
      args.successUrl,
    );
    if (!response?.token || !response?.url) {
      throw new Error("No se pudo crear la transacción Webpay");
    }

    return {
      provider: "webpay",
      reference: response.token,
      paymentUrl: response.url,
      redirectMethod: "POST",
      redirectPayload: {
        token_ws: response.token,
      },
    };
  },
};
