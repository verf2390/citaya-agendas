import {
  calculateServicePolicySnapshot,
  safeClpNumber,
} from "@/services/payments/service-payment-policy";

export type PaymentCollectionMode = "none" | "full" | "deposit";
export type DepositType = "percentage" | "fixed" | null;

export type PaymentBreakdown = {
  totalAmount: number;
  requiredOnlineAmount: number;
  remainingAmount: number;
  paymentMode: PaymentCollectionMode;
  depositType: DepositType;
  depositValue: number | null;
};

type CalculatePaymentBreakdownParams = {
  totalAmount: number | null | undefined;
  paymentMode?: PaymentCollectionMode | null;
  depositType?: DepositType;
  depositValue?: number | null;
};

function normalizeMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

export function calculatePaymentBreakdown({
  totalAmount,
  paymentMode = "full",
  depositType = null,
  depositValue = null,
}: CalculatePaymentBreakdownParams): PaymentBreakdown {
  const normalizedTotal = normalizeMoney(Number(totalAmount ?? 0));
  const normalizedMode = paymentMode ?? "full";

  if (normalizedMode === "none" || normalizedTotal <= 0) {
    return {
      totalAmount: normalizedTotal,
      requiredOnlineAmount: 0,
      remainingAmount: normalizedTotal,
      paymentMode: "none",
      depositType: null,
      depositValue: null,
    };
  }

  if (normalizedMode === "deposit") {
    const value = Number(depositValue ?? 0);
    const snapshot = calculateServicePolicySnapshot({
      serviceId: "legacy-tenant-payment-setting",
      totalAmount: normalizedTotal,
      paymentPolicy: "deposit",
      depositType: depositType === "fixed" ? "fixed_amount" : depositType,
      depositValue: depositType === "percentage"
        ? Math.round(value * 100)
        : Math.round(value),
    });
    const requiredOnlineAmount = safeClpNumber(snapshot.initialPaymentDue);

    return {
      totalAmount: normalizedTotal,
      requiredOnlineAmount,
      remainingAmount: Math.max(normalizedTotal - requiredOnlineAmount, 0),
      paymentMode: "deposit",
      depositType,
      depositValue: Number.isFinite(value) && value > 0 ? value : null,
    };
  }

  return {
    totalAmount: normalizedTotal,
    requiredOnlineAmount: normalizedTotal,
    remainingAmount: 0,
    paymentMode: "full",
    depositType: null,
    depositValue: null,
  };
}
