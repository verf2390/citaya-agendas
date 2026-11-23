export function splitSettlementAmount(amount, basisPoints) {
  const professionalAmount = Math.round(amount * basisPoints / 10_000);
  return { professionalAmount, businessAmount: amount - professionalAmount };
}

/**
 * Calculate a gross-collected CLP settlement preview from normalized payments.
 * Each payment must represent its own verified amount, not the appointment total.
 */
export function previewPercentageSettlement({ payments, percentages, period, closedPaymentIds = [] }) {
  if (!period.start || !period.end || period.start > period.end) {
    throw new RangeError("Indica un periodo válido.");
  }

  const seen = new Set(closedPaymentIds);
  const rows = [];
  const byProfessional = new Map();

  for (const payment of payments) {
    if (payment.status !== "VERIFIED" || payment.paidOn < period.start ||
        payment.paidOn > period.end || !payment.paidOn || seen.has(payment.id)) {
      continue;
    }

    const percentage = percentages.get(payment.professionalId);
    const basisPoints = Math.round(percentage * 100);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100 ||
        Math.abs(percentage * 100 - basisPoints) > 1e-8) {
      throw new RangeError("Asigna a cada profesional un porcentaje de 0 a 100 con hasta dos decimales.");
    }
    if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0 ||
        !Number.isSafeInteger(payment.amount * 10_000)) {
      throw new RangeError("El monto cobrado debe ser un importe positivo en pesos enteros.");
    }

    seen.add(payment.id);
    const { professionalAmount, businessAmount } = splitSettlementAmount(payment.amount, basisPoints);
    rows.push({ ...payment, percentage, professionalAmount, businessAmount });

    const group = byProfessional.get(payment.professionalId) ?? {
      professionalId: payment.professionalId,
      percentage,
      collected: 0,
      professionalAmount: 0,
      businessAmount: 0,
      paymentCount: 0,
    };
    group.collected += payment.amount;
    group.professionalAmount += professionalAmount;
    group.businessAmount += businessAmount;
    group.paymentCount += 1;
    byProfessional.set(payment.professionalId, group);
  }

  return {
    period: { ...period },
    rows,
    professionals: Array.from(byProfessional.values()),
  };
}
