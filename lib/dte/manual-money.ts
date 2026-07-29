export type ManualGrossLine = {
  description: string;
  quantity: number;
  unitGrossAmount: number;
  grossAmount: number;
};

export type ManualMoney = {
  grossAmount: number;
  netAmount: number;
  exemptAmount: number;
  taxAmount: number;
};

type ManualReviewInput = {
  tenantId: string;
  source: string;
  dteType: number;
  customerId: string;
  appointmentId: string | null;
  paymentIntentId: string | null;
  lines: ManualGrossLine[];
  money: ManualMoney;
};

function positiveClpInteger(value: unknown, field: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${field}_INVALID`);
  }
  return amount;
}

export function validateManualGrossLines(input: unknown): ManualGrossLine[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
    throw new Error("DTE_MANUAL_LINES_INVALID");
  }
  return input.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("DTE_MANUAL_LINE_INVALID");
    }
    const line = candidate as Record<string, unknown>;
    const description = String(line.description ?? "").trim().slice(0, 180);
    const quantity = positiveClpInteger(
      line.quantity,
      `DTE_MANUAL_LINE_${index}_QUANTITY`,
    );
    const unitGrossAmount = positiveClpInteger(
      line.unitGrossAmount,
      `DTE_MANUAL_LINE_${index}_UNIT_GROSS_AMOUNT`,
    );
    const grossAmount = quantity * unitGrossAmount;
    if (!description || !Number.isSafeInteger(grossAmount)) {
      throw new Error("DTE_MANUAL_LINE_INVALID");
    }
    return { description, quantity, unitGrossAmount, grossAmount };
  });
}

export function calculateManualMoney(
  lines: ManualGrossLine[],
  exempt: boolean,
): ManualMoney {
  const grossAmount = lines.reduce((sum, line) => sum + line.grossAmount, 0);
  if (!Number.isSafeInteger(grossAmount) || grossAmount <= 0) {
    throw new Error("DTE_MANUAL_GROSS_AMOUNT_INVALID");
  }
  if (exempt) {
    return { grossAmount, netAmount: 0, exemptAmount: grossAmount, taxAmount: 0 };
  }
  const netAmount = Math.round(grossAmount / 1.19);
  const taxAmount = grossAmount - netAmount;
  return { grossAmount, netAmount, exemptAmount: 0, taxAmount };
}

export function manualReviewMaterial(input: ManualReviewInput): string {
  return JSON.stringify({
    tenantId: input.tenantId,
    source: input.source,
    dteType: input.dteType,
    customerId: input.customerId,
    appointmentId: input.appointmentId,
    paymentIntentId: input.paymentIntentId,
    lines: input.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitGrossAmount: line.unitGrossAmount,
      grossAmount: line.grossAmount,
    })),
    money: {
      grossAmount: input.money.grossAmount,
      netAmount: input.money.netAmount,
      exemptAmount: input.money.exemptAmount,
      taxAmount: input.money.taxAmount,
    },
  });
}
