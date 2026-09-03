import type {
  CreateProviderPaymentParams,
  PaymentProvider,
} from "@/services/payments/providers/types";
import { webpayTransaction } from "@/services/payments/webpay-transaction";

export const webpayProvider: PaymentProvider = {
  id: "webpay",
  async createPayment(args: CreateProviderPaymentParams) {
    const commerceCode = String(
      args.config.credentials?.commerceCode ?? "",
    ).trim();
    const apiKey = String(args.config.credentials?.apiKey ?? "").trim();
    const environment = String(
      args.config.credentials?.environment ?? "",
    ).trim();
    if (
      !commerceCode ||
      !apiKey ||
      (environment !== "integration" && environment !== "production")
    ) {
      throw new Error("Faltan credenciales de Webpay");
    }
    const buyOrder = String(args.buyOrder ?? "").trim();
    const sessionId = String(args.sessionId ?? "").trim();
    if (!buyOrder || !sessionId) {
      throw new Error("Falta vínculo interno de Webpay");
    }
    const response = await webpayTransaction({
      commerceCode,
      apiKey,
      environment,
      source: args.config.credentialSource ?? "tenant",
    }).create(
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
