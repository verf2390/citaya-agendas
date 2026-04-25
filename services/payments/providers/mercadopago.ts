import { createMercadoPagoPreference } from "@/services/payments/mercadopago";
import type {
  CreateProviderPaymentParams,
  PaymentProvider,
} from "@/services/payments/providers/types";

export const mercadoPagoProvider: PaymentProvider = {
  id: "mercadopago",
  async createPayment(args: CreateProviderPaymentParams) {
    const accessToken = String(args.config.credentials?.accessToken ?? "").trim();

    if (!accessToken) {
      throw new Error("Falta access token de Mercado Pago");
    }

    const preference = await createMercadoPagoPreference({
      accessToken,
      title: args.title,
      amount: args.amount,
      currencyId: args.currency,
      externalReference: args.appointmentId,
      payer: args.customerEmail
        ? {
            email: args.customerEmail,
            name: args.customerName ?? undefined,
          }
        : undefined,
      successUrl: args.successUrl,
      failureUrl: args.failureUrl,
      pendingUrl: args.pendingUrl,
      notificationUrl: args.notificationUrl,
    });

    return {
      provider: "mercadopago",
      reference: preference.id ?? null,
      paymentUrl: preference.init_point ?? null,
      redirectMethod: "GET",
      raw: preference,
    };
  },
};
