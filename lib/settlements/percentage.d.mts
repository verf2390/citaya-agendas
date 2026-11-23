export type SettlementPayment = {
  id: string
  professionalId: string
  description: string
  amount: number
  paidOn: string
  serviceAt: string
  status: "VERIFIED" | "PENDING" | "REFUNDED"
}

export type SettlementPeriod = { start: string; end: string }

export type SettlementPreview = {
  period: SettlementPeriod
  rows: Array<SettlementPayment & {
    percentage: number
    professionalAmount: number
    businessAmount: number
  }>
  professionals: Array<{
    professionalId: string
    percentage: number
    collected: number
    professionalAmount: number
    businessAmount: number
    paymentCount: number
  }>
}

export function previewPercentageSettlement(input: {
  payments: readonly SettlementPayment[]
  percentages: ReadonlyMap<string, number>
  period: SettlementPeriod
  closedPaymentIds?: readonly string[]
}): SettlementPreview

export function splitSettlementAmount(amount: number, basisPoints: number): {
  professionalAmount: number
  businessAmount: number
}
