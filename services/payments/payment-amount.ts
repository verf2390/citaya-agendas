export type PaymentMode = 'none' | 'optional' | 'required';
export type DepositType = 'fixed' | 'percentage' | null;

interface CalculatePaymentParams {
  servicePrice: number;
  paymentMode: PaymentMode;
  depositType?: DepositType;
  depositValue?: number | null;
}

export function calculatePaymentAmount({
  servicePrice,
  paymentMode,
  depositType,
  depositValue
}: CalculatePaymentParams): number {
  
  // 1. Si no hay pago
  if (paymentMode === 'none') {
    return 0;
  }

  // 2. Si no hay configuración de abono → cobrar completo
  if (!depositType || !depositValue) {
    return servicePrice;
  }

  // 3. Abono fijo
  if (depositType === 'fixed') {
    return Math.min(depositValue, servicePrice);
  }

  // 4. Abono por porcentaje
  if (depositType === 'percentage') {
    const amount = servicePrice * (depositValue / 100);
    return Math.round(amount);
  }

  // fallback seguro
  return servicePrice;
}