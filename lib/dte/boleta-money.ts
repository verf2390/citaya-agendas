export type BoletaGrossLineInput = {
  description: string;
  quantity: number;
  unitGrossAmount: number;
  exempt?: boolean;
  unitOfMeasure?: string | null;
};

export type CalculatedBoletaLine = BoletaGrossLineInput & {
  position: number;
  grossAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
};

export type BoletaTotals = {
  netAmount: number;
  exemptAmount: number;
  taxAmount: number;
  totalAmount: number;
  lines: CalculatedBoletaLine[];
};

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${field}_INVALID`);
  }
  return parsed;
}

function roundDiv(numerator: bigint, denominator: bigint): number {
  const rounded = Number((numerator + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(rounded)) throw new Error("DTE_AMOUNT_OVERFLOW");
  return rounded;
}

function allocateAffectedNet(
  grossLines: Array<{ index: number; gross: number }>,
  documentNet: number,
): Map<number, number> {
  const grossTotal = grossLines.reduce((sum, line) => sum + line.gross, 0);
  if (grossTotal <= 0) return new Map();

  const allocations = grossLines.map((line) => {
    const numerator = BigInt(line.gross) * BigInt(documentNet);
    return {
      ...line,
      net: Number(numerator / BigInt(grossTotal)),
      remainder: numerator % BigInt(grossTotal),
    };
  });
  let pending = documentNet - allocations.reduce((sum, line) => sum + line.net, 0);
  for (const allocation of allocations
    .slice()
    .sort((left, right) =>
      left.remainder === right.remainder
        ? left.index - right.index
        : left.remainder > right.remainder
          ? -1
          : 1,
    )) {
    if (pending === 0) break;
    allocations.find((line) => line.index === allocation.index)!.net += 1;
    pending -= 1;
  }
  if (pending !== 0) throw new Error("DTE_BOLETA_NET_ALLOCATION_FAILED");
  return new Map(allocations.map((line) => [line.index, line.net]));
}

/**
 * Tipo 39 without IndMntNeto=2: PrcItem and MontoItem are gross CLP values.
 * Tax totals are calculated once at document level and then allocated to the
 * frozen lines only for Citaya's snapshot/audit model.
 */
export function calculateBoletaGrossTotals(
  input: readonly BoletaGrossLineInput[],
): BoletaTotals {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
    throw new Error("DTE_BOLETA_LINES_INVALID");
  }

  const normalized = input.map((line, index) => {
    const description = String(line.description ?? "").trim().slice(0, 80);
    const quantity = integer(line.quantity, `DTE_BOLETA_LINE_${index}_QUANTITY`, 1);
    const unitGrossAmount = integer(
      line.unitGrossAmount,
      `DTE_BOLETA_LINE_${index}_UNIT_GROSS`,
      1,
    );
    const grossAmount = quantity * unitGrossAmount;
    if (!description || !Number.isSafeInteger(grossAmount)) {
      throw new Error(`DTE_BOLETA_LINE_${index}_INVALID`);
    }
    return {
      description,
      quantity,
      unitGrossAmount,
      exempt: line.exempt === true,
      unitOfMeasure: line.unitOfMeasure
        ? String(line.unitOfMeasure).trim().slice(0, 4)
        : null,
      grossAmount,
    };
  });

  const affected = normalized
    .map((line, index) => ({ index, gross: line.exempt ? 0 : line.grossAmount }))
    .filter((line) => line.gross > 0);
  const affectedGross = affected.reduce((sum, line) => sum + line.gross, 0);
  const exemptAmount = normalized
    .filter((line) => line.exempt)
    .reduce((sum, line) => sum + line.grossAmount, 0);
  const netAmount =
    affectedGross === 0
      ? 0
      : roundDiv(BigInt(affectedGross) * 100n, 119n);
  const taxAmount = affectedGross - netAmount;
  const totalAmount = affectedGross + exemptAmount;
  const netByIndex = allocateAffectedNet(affected, netAmount);

  const lines = normalized.map((line, index): CalculatedBoletaLine => {
    const lineNet = line.exempt ? 0 : (netByIndex.get(index) ?? 0);
    return {
      description: line.description,
      quantity: line.quantity,
      unitGrossAmount: line.unitGrossAmount,
      exempt: line.exempt,
      unitOfMeasure: line.unitOfMeasure,
      position: index + 1,
      grossAmount: line.grossAmount,
      netAmount: lineNet,
      taxAmount: line.exempt ? 0 : line.grossAmount - lineNet,
      totalAmount: line.grossAmount,
    };
  });

  if (
    lines.reduce((sum, line) => sum + line.netAmount, 0) !== netAmount ||
    lines.reduce((sum, line) => sum + line.taxAmount, 0) !== taxAmount ||
    netAmount + taxAmount + exemptAmount !== totalAmount
  ) {
    throw new Error("DTE_BOLETA_TOTALS_INCONSISTENT");
  }
  return { netAmount, exemptAmount, taxAmount, totalAmount, lines };
}

export function sumBoletaRvdTotals(
  documents: readonly Pick<
    BoletaTotals,
    "netAmount" | "exemptAmount" | "taxAmount" | "totalAmount"
  >[],
) {
  const totals = documents.reduce(
    (sum, document) => ({
      netAmount: sum.netAmount + document.netAmount,
      exemptAmount: sum.exemptAmount + document.exemptAmount,
      taxAmount: sum.taxAmount + document.taxAmount,
      totalAmount: sum.totalAmount + document.totalAmount,
    }),
    { netAmount: 0, exemptAmount: 0, taxAmount: 0, totalAmount: 0 },
  );
  if (
    totals.netAmount + totals.taxAmount + totals.exemptAmount !==
    totals.totalAmount
  ) {
    throw new Error("DTE_RVD_TOTALS_INCONSISTENT");
  }
  return totals;
}
