import type {
  CreateProviderPaymentParams,
  PaymentProvider,
} from "@/services/payments/providers/types";

type KhipuCreatePaymentResponse = {
  payment_id?: string;
  payment_url?: string;
  transfer_url?: string;
  simplified_transfer_url?: string;
};

export const khipuProvider: PaymentProvider = {
  id: "khipu",
  async createPayment(args: CreateProviderPaymentParams) {
    const secret = String(args.config.credentials?.secret ?? "").trim();

    if (!secret) {
      throw new Error("Falta secret de Khipu");
    }

    const res = await fetch("https://payment-api.khipu.com/v3/payments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": secret,
      },
      body: JSON.stringify({
        amount: args.amount,
        currency: args.currency,
        subject: args.title,
        transaction_id: args.appointmentId,
        custom: JSON.stringify({
          tenantId: args.tenantId,
          appointmentId: args.appointmentId,
        }),
        return_url: args.pendingUrl,
        cancel_url: args.failureUrl,
        notify_url: args.notificationUrl,
        notify_api_version: "3.0",
        payer_name: args.customerName ?? undefined,
        payer_email: args.customerEmail ?? undefined,
      }),
    });

    const json = (await res.json().catch(() => null)) as
      | KhipuCreatePaymentResponse
      | null;

    if (!res.ok || !json?.payment_id || !json.payment_url) {
      throw new Error("No se pudo crear el pago en Khipu");
    }

    return {
      provider: "khipu",
      reference: json.payment_id,
      paymentUrl: json.payment_url,
      redirectMethod: "GET",
      raw: json,
    };
  },
};
