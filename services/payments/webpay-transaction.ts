import {
  Environment,
  Options,
  WebpayPlus,
} from "transbank-sdk";

import type { WebpayCredentials } from "@/services/payments/provider-credentials";

export function webpayTransaction(credentials: WebpayCredentials) {
  const options = new Options(
    credentials.commerceCode,
    credentials.apiKey,
    credentials.environment === "production"
      ? Environment.Production
      : Environment.Integration,
  );
  return new WebpayPlus.Transaction(options);
}
