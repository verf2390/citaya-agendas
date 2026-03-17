import { MercadoPagoConfig, Preference } from 'mercadopago';

interface CreatePreferenceParams {
  accessToken: string;
  title: string;
  amount: number;
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
          currency_id: 'CLP',
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