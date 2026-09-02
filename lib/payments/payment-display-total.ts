type PaymentAmountSnapshot = {
  payment_required_amount: unknown;
  payment_paid_amount: unknown;
  payment_remaining_amount: unknown;
};

function persistedMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function paymentDisplayTotal(snapshot: PaymentAmountSnapshot) {
  const paid = persistedMoney(snapshot.payment_paid_amount);
  const remaining = persistedMoney(snapshot.payment_remaining_amount);

  if (paid !== null && remaining !== null) return paid + remaining;

  // Legacy rows may predate the complete paid/remaining snapshot. In those
  // cases only, the required amount is the most conservative persisted value.
  return persistedMoney(snapshot.payment_required_amount) ?? 0;
}
