import type {
  CreateProviderPaymentParams,
  PaymentProvider,
} from "@/services/payments/providers/types";

type WebpayCreateResponse = {
  token?: string;
  url?: string;
};

function webpayBaseUrl(environment?: string | null) {
  return environment === "production"
    ? "https://webpay3g.transbank.cl"
    : "https://webpay3gint.transbank.cl";
}

export const webpayProvider: PaymentProvider = {
  id: "webpay",
  async createPayment(args: CreateProviderPaymentParams) {
    const commerceCode = String(args.config.credentials?.commerceCode ?? "").trim();
    const apiKey = String(args.config.credentials?.apiKey ?? "").trim();
    const environment = String(
      args.config.credentials?.environment ?? "integration",
    ).trim();

    if (!commerceCode || !apiKey) {
      throw new Error("Faltan credenciales de Webpay");
    }

    const buyOrder = args.appointmentId.replace(/-/g, "").slice(0, 26);
    const sessionId = args.tenantId.replace(/-/g, "").slice(0, 61);
    const baseUrl = webpayBaseUrl(environment);
    const res = await fetch(
      `${baseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Tbk-Api-Key-Id": commerceCode,
          "Tbk-Api-Key-Secret": apiKey,
        },
        body: JSON.stringify({
          buy_order: buyOrder,
          session_id: sessionId,
          amount: args.amount,
          return_url: args.successUrl,
        }),
      },
    );

    const json = (await res.json().catch(() => null)) as WebpayCreateResponse | null;

    if (!res.ok || !json?.token || !json.url) {
      throw new Error("No se pudo crear la transacción Webpay");
    }

    return {
      provider: "webpay",
      reference: json.token,
      paymentUrl: json.url,
      redirectMethod: "POST",
      redirectPayload: {
        token_ws: json.token,
      },
      raw: json,
    };
  },
};
