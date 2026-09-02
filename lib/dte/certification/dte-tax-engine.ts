export const DTE_VAT_RATE_PERCENT = 19;

export type DteTaxLineInput = {
  name: string;
  quantity: number;
  unitPrice: number;
  exempt?: boolean;
  discountPercent?: number | null;
};

export type DteGlobalDiscountInput = {
  percent: number;
  appliesTo: "affected";
};

export type DteExpectedTotals = {
  netAmount: number;
  exemptAmount: number;
  vatAmount: number;
  totalAmount: number;
};

export type DteCalculatedLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  exempt: boolean;
  indExe?: 1;
  grossAmount: number;
  discountPercent?: number;
  discountAmount: number;
  montoItem: number;
};

export type DteCalculatedGlobalDiscount = {
  discountType: "D";
  valueType: "%";
  discountPercent: number;
  discountAmount: number;
  appliesTo: "affected";
};

export type DteTaxCalculationInput = {
  lines: readonly DteTaxLineInput[];
  globalDiscount?: DteGlobalDiscountInput | null;
  expectedTotals?: DteExpectedTotals | null;
};

export type DteTaxCalculationResult = {
  lines: DteCalculatedLine[];
  globalDiscount: DteCalculatedGlobalDiscount | null;
  netAmount: number;
  exemptAmount: number;
  vatRate: typeof DTE_VAT_RATE_PERCENT;
  vatAmount: number;
  totalAmount: number;
};

function assertInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} debe ser un entero seguro en CLP`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  assertInteger(value, field);
  if (value <= 0) throw new Error(`${field} debe ser mayor que cero`);
}

function assertNonNegativeInteger(value: number, field: string): void {
  assertInteger(value, field);
  if (value < 0) throw new Error(`${field} no puede ser negativo`);
}

function percentToBasisPoints(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} debe ser numerico`);
  if (value < 0 || value > 100) throw new Error(`${field} debe estar entre 0 y 100`);
  const basisPoints = Math.round(value * 100);
  if (Math.abs(basisPoints / 100 - value) > 0.0000001) {
    throw new Error(`${field} admite hasta dos decimales`);
  }
  return basisPoints;
}

function roundDiv(numerator: bigint, denominator: bigint): number {
  const rounded = (numerator + denominator / BigInt(2)) / denominator;
  const value = Number(rounded);
  assertInteger(value, "monto calculado");
  return value;
}

function percentAmount(amount: number, percent: number, field: string): number {
  assertNonNegativeInteger(amount, field);
  const basisPoints = percentToBasisPoints(percent, `${field} porcentaje`);
  return roundDiv(BigInt(amount) * BigInt(basisPoints), BigInt(10000));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function validateExpectedTotals(expected: DteExpectedTotals): void {
  assertNonNegativeInteger(expected.netAmount, "expectedTotals.netAmount");
  assertNonNegativeInteger(expected.exemptAmount, "expectedTotals.exemptAmount");
  assertNonNegativeInteger(expected.vatAmount, "expectedTotals.vatAmount");
  assertNonNegativeInteger(expected.totalAmount, "expectedTotals.totalAmount");
}

export function calculateDteTaxTotals(input: DteTaxCalculationInput): DteTaxCalculationResult {
  if (input.lines.length === 0) throw new Error("Debe existir al menos una linea DTE");

  const lines = input.lines.map((line, index): DteCalculatedLine => {
    const prefix = `lines[${index}]`;
    if (!line.name.trim()) throw new Error(`${prefix}.name requerido`);
    assertPositiveInteger(line.quantity, `${prefix}.quantity`);
    assertNonNegativeInteger(line.unitPrice, `${prefix}.unitPrice`);

    const grossAmount = line.quantity * line.unitPrice;
    assertNonNegativeInteger(grossAmount, `${prefix}.grossAmount`);
    const discountPercent = line.discountPercent ?? 0;
    const discountAmount = percentAmount(grossAmount, discountPercent, `${prefix}.discount`);
    if (discountAmount > grossAmount) throw new Error(`${prefix}.discountAmount excede el monto bruto`);

    return {
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      exempt: line.exempt === true,
      indExe: line.exempt === true ? 1 : undefined,
      grossAmount,
      discountPercent: discountPercent > 0 ? discountPercent : undefined,
      discountAmount,
      montoItem: grossAmount - discountAmount,
    };
  });

  const affectedSubtotal = sum(lines.filter((line) => !line.exempt).map((line) => line.montoItem));
  const exemptAmount = sum(lines.filter((line) => line.exempt).map((line) => line.montoItem));

  let globalDiscount: DteCalculatedGlobalDiscount | null = null;
  let netAmount = affectedSubtotal;
  if (input.globalDiscount) {
    if (input.globalDiscount.appliesTo !== "affected") {
      throw new Error("Solo se permite descuento global aplicado a montos afectos en PRE-CAF 1");
    }
    const discountAmount = percentAmount(affectedSubtotal, input.globalDiscount.percent, "globalDiscount");
    if (discountAmount > affectedSubtotal) throw new Error("globalDiscount excede el monto afecto");
    netAmount = affectedSubtotal - discountAmount;
    globalDiscount = {
      discountType: "D",
      valueType: "%",
      discountPercent: input.globalDiscount.percent,
      discountAmount,
      appliesTo: "affected",
    };
  }

  const vatAmount = percentAmount(netAmount, DTE_VAT_RATE_PERCENT, "IVA");
  const totalAmount = netAmount + exemptAmount + vatAmount;
  const result: DteTaxCalculationResult = {
    lines,
    globalDiscount,
    netAmount,
    exemptAmount,
    vatRate: DTE_VAT_RATE_PERCENT,
    vatAmount,
    totalAmount,
  };

  if (input.expectedTotals) {
    validateExpectedTotals(input.expectedTotals);
    const expected = input.expectedTotals;
    if (
      expected.netAmount !== result.netAmount ||
      expected.exemptAmount !== result.exemptAmount ||
      expected.vatAmount !== result.vatAmount ||
      expected.totalAmount !== result.totalAmount
    ) {
      throw new Error(
        `Totales esperados no cuadran con calculo: expected=${JSON.stringify(expected)} calculated=${JSON.stringify({
          netAmount: result.netAmount,
          exemptAmount: result.exemptAmount,
          vatAmount: result.vatAmount,
          totalAmount: result.totalAmount,
        })}`,
      );
    }
  }

  if (result.totalAmount !== result.netAmount + result.exemptAmount + result.vatAmount) {
    throw new Error("Cuadratura invalida: MntTotal debe ser MntNeto + MntExe + IVA");
  }

  return result;
}
