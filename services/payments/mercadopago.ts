import { MercadoPagoConfig, Payment, Preference } from "mercadopago";

export type InternalPaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled";

interface CreatePreferenceParams {
  accessToken: string;
  title: string;
  amount: number;
  currencyId?: string;
  quantity?: number;
  externalReference: string;
  payer?: {
    name?: string;
    email?: string;
  };
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  notificationUrl: string;
}

export async function createMercadoPagoPreference({
  accessToken,
  title,
  amount,
  currencyId = "CLP",
  quantity = 1,
  externalReference,
  payer,
  successUrl,
  failureUrl,
  pendingUrl,
  notificationUrl,
}: CreatePreferenceParams) {
  const client = new MercadoPagoConfig({
    accessToken,
  });

  const preference = new Preference(client);

  const response = await preference.create({
    body: {
      items: [
        {
          id: externalReference,
          title,
          quantity,
          unit_price: amount,
          currency_id: currencyId,
        },
      ],
      external_reference: externalReference,
      payer: payer?.email
        ? {
            email: payer.email,
            name: payer.name,
          }
        : undefined,
      back_urls: {
        success: successUrl,
        failure: failureUrl,
        pending: pendingUrl,
      },
      notification_url: notificationUrl,
      auto_return: 'approved',
    },
  });

  return response;
}

export async function fetchMercadoPagoPayment(args: {
  accessToken: string;
  paymentId: string | number;
}) {
  const client = new MercadoPagoConfig({
    accessToken: args.accessToken,
  });

  const payment = new Payment(client);
  return payment.get({ id: args.paymentId });
}

export function mapMercadoPagoStatus(status?: string | null): InternalPaymentStatus {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
      return "paid";
    case "cancelled":
    case "cancelled_by_user":
    case "expired":
      return "cancelled";
    case "rejected":
    case "charged_back":
    case "refunded":
      return "failed";
    case "authorized":
    case "in_process":
    case "in_mediation":
    case "pending":
    default:
      return "pending";
  }
}
