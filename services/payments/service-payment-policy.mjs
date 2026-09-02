function integer(value, field) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${field}_INVALID_INTEGER_CLP`);
  }
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    throw new Error(`${field}_INVALID_INTEGER_CLP`);
  }
  return BigInt(value);
}

export function calculateServicePolicySnapshot(input) {
  const totalAmount = integer(input.totalAmount, "TOTAL_AMOUNT");
  const rawDeposit = input.depositValue == null
    ? null
    : integer(input.depositValue, "DEPOSIT_VALUE");
  let initialPaymentDue = BigInt(0);
  let depositType = null;
  let depositValue = null;
  if (input.paymentPolicy === "full_payment") {
    if (totalAmount === BigInt(0)) throw new Error("ZERO_PRICE_ADVANCE_UNSUPPORTED");
    initialPaymentDue = totalAmount;
  } else if (input.paymentPolicy === "deposit") {
    depositType = input.depositType ?? null;
    depositValue = rawDeposit;
    if (!depositType || depositValue == null || depositValue <= BigInt(0)) {
      throw new Error("DEPOSIT_CONFIGURATION_INCOMPLETE");
    }
    if (depositType === "fixed_amount") {
      if (depositValue > totalAmount) throw new Error("DEPOSIT_EXCEEDS_TOTAL");
      initialPaymentDue = depositValue;
    } else {
      if (depositValue >= BigInt(10_000)) throw new Error("DEPOSIT_PERCENTAGE_OUT_OF_RANGE");
      initialPaymentDue = (totalAmount * depositValue + BigInt(5_000)) / BigInt(10_000);
    }
    const depositMinimum = input.depositMinimum == null
      ? null : integer(input.depositMinimum, "DEPOSIT_MINIMUM");
    const depositMaximum = input.depositMaximum == null
      ? null : integer(input.depositMaximum, "DEPOSIT_MAXIMUM");
    if (depositMinimum != null) initialPaymentDue = initialPaymentDue > depositMinimum
      ? initialPaymentDue : depositMinimum;
    if (depositMaximum != null) initialPaymentDue = initialPaymentDue < depositMaximum
      ? initialPaymentDue : depositMaximum;
    if (depositMinimum != null && depositMaximum != null && depositMinimum > depositMaximum) {
      throw new Error("DEPOSIT_LIMITS_INVALID");
    }
    if (initialPaymentDue > totalAmount) throw new Error("DEPOSIT_EXCEEDS_TOTAL");
  }
  return { serviceId: input.serviceId, totalAmount, paymentPolicy: input.paymentPolicy,
    depositType, depositValue, depositMinimum: input.depositMinimum == null ? null : integer(input.depositMinimum, "DEPOSIT_MINIMUM"),
    depositMaximum: input.depositMaximum == null ? null : integer(input.depositMaximum, "DEPOSIT_MAXIMUM"),
    initialPaymentDue, balanceDue: totalAmount - initialPaymentDue,
    roundingPolicy: "HALF_UP_BASIS_POINTS" };
}

export function calculateMixedSalePolicy(lines) {
  if (lines.length === 0 || lines.length > 50) throw new Error("SALE_LINES_INVALID");
  const snapshots = lines.map(calculateServicePolicySnapshot);
  return snapshots.reduce((sale, line) => ({
    lines: [...sale.lines, line], totalAmount: sale.totalAmount + line.totalAmount,
    initialPaymentDue: sale.initialPaymentDue + line.initialPaymentDue,
    balanceDue: sale.balanceDue + line.balanceDue,
    taxTreatmentStatus: sale.taxTreatmentStatus === "REVIEW_REQUIRED" || line.paymentPolicy === "deposit"
      ? "REVIEW_REQUIRED" : "PENDING",
  }), { lines: [], totalAmount: BigInt(0), initialPaymentDue: BigInt(0),
    balanceDue: BigInt(0), taxTreatmentStatus: "PENDING" });
}

export function safeClpNumber(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("CLP_AMOUNT_OUT_OF_SAFE_RANGE");
  return result;
}
