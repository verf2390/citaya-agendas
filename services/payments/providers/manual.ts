import type {
  CreateProviderPaymentParams,
  PaymentProvider,
} from "@/services/payments/providers/types";

export const manualProvider: PaymentProvider = {
  id: "manual",
  async createPayment(args: CreateProviderPaymentParams) {
    return {
      provider: "manual",
      reference: args.appointmentId,
      paymentUrl: `${args.pendingUrl}&id=${encodeURIComponent(args.appointmentId)}&provider=manual`,
      redirectMethod: "GET",
    };
  },
};
