import {
  calculateMixedSalePolicy as calculateMixedSalePolicyCore,
  calculateServicePolicySnapshot as calculateServicePolicySnapshotCore,
  safeClpNumber as safeClpNumberCore,
} from "./service-payment-policy.mjs";

export type ServicePaymentPolicy = "no_advance" | "deposit" | "full_payment";
export type ServiceDepositType = "fixed_amount" | "percentage" | null;
export type ServicePolicySnapshot = {
  serviceId: string; totalAmount: bigint; paymentPolicy: ServicePaymentPolicy;
  depositType: ServiceDepositType; depositValue: bigint | null;
  initialPaymentDue: bigint; balanceDue: bigint;
};
export type ServicePolicyInput = {
  serviceId: string; totalAmount: bigint | number | string;
  paymentPolicy: ServicePaymentPolicy; depositType?: ServiceDepositType;
  depositValue?: bigint | number | string | null;
};
export type MixedSalePolicy = {
  lines: ServicePolicySnapshot[]; totalAmount: bigint; initialPaymentDue: bigint;
  balanceDue: bigint; taxTreatmentStatus: "PENDING" | "REVIEW_REQUIRED";
};

export function calculateServicePolicySnapshot(input: ServicePolicyInput): ServicePolicySnapshot {
  return calculateServicePolicySnapshotCore(input) as ServicePolicySnapshot;
}
export function calculateMixedSalePolicy(lines: ServicePolicyInput[]): MixedSalePolicy {
  return calculateMixedSalePolicyCore(lines) as MixedSalePolicy;
}
export function safeClpNumber(value: bigint): number {
  return safeClpNumberCore(value) as number;
}
