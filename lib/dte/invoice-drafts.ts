import { calculateDteTaxTotals } from "./certification/dte-tax-engine";

export const INVOICE_DRAFT_EDITABLE_STATUSES = [
  "DRAFT",
  "REVIEW_REQUIRED",
  "VALIDATED",
] as const;

export type InvoiceDraftStatus =
  | (typeof INVOICE_DRAFT_EDITABLE_STATUSES)[number]
  | "QUEUED"
  | "PREPARING"
  | "SUBMITTING"
  | "SUBMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELED";

export type InvoiceDraftLineInput = {
  serviceId?: string | null;
  appointmentId?: string | null;
  description: string;
  quantity: number;
  unitNetAmount: number;
  discountBasisPoints?: number | null;
  pricingMode?: "manual_net" | "catalog_gross";
  catalogUnitGrossAmount?: number | null;
};

export type CalculatedInvoiceLine = InvoiceDraftLineInput & {
  position: number;
  discountBasisPoints: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
};

export type InvoiceTotals = {
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  lines: CalculatedInvoiceLine[];
};

export type TaxIdentity = {
  rut: string;
  legalName: string;
  businessActivity: string;
  address: string;
  commune: string;
  city: string;
  email?: string | null;
};

export type FinalTaxSnapshot = {
  issuer: TaxIdentity;
  recipient: TaxIdentity;
  capturedAt: string;
};

function safeInteger(value: unknown, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${field}_INVALID`);
  }
  return parsed;
}

function roundDiv(numerator: bigint, denominator: bigint): number {
  const result = Number(
    (numerator + denominator / BigInt(2)) / denominator,
  );
  if (!Number.isSafeInteger(result)) throw new Error("DTE_AMOUNT_OVERFLOW");
  return result;
}

export function validateInvoiceDraftLines(input: unknown): InvoiceDraftLineInput[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
    throw new Error("DTE_INVOICE_LINES_INVALID");
  }
  return input.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`DTE_INVOICE_LINE_${index}_INVALID`);
    }
    const line = candidate as Record<string, unknown>;
    const description = String(line.description ?? "").trim().slice(0, 180);
    const quantity = safeInteger(line.quantity, `DTE_INVOICE_LINE_${index}_QUANTITY`, 1);
    const unitNetAmount = safeInteger(
      line.unitNetAmount,
      `DTE_INVOICE_LINE_${index}_UNIT_NET`,
      1,
    );
    const discountBasisPoints = safeInteger(
      line.discountBasisPoints ?? 0,
      `DTE_INVOICE_LINE_${index}_DISCOUNT`,
    );
    const pricingMode = line.pricingMode === "catalog_gross"
      ? "catalog_gross"
      : "manual_net";
    const catalogUnitGrossAmount = pricingMode === "catalog_gross"
      ? safeInteger(
          line.catalogUnitGrossAmount,
          `DTE_INVOICE_LINE_${index}_CATALOG_GROSS`,
          1,
        )
      : null;
    if (
      !description ||
      discountBasisPoints > 10_000 ||
      (pricingMode === "catalog_gross" && discountBasisPoints !== 0)
    ) {
      throw new Error(`DTE_INVOICE_LINE_${index}_INVALID`);
    }
    return {
      serviceId: line.serviceId ? String(line.serviceId) : null,
      appointmentId: line.appointmentId ? String(line.appointmentId) : null,
      description,
      quantity,
      unitNetAmount,
      discountBasisPoints,
      pricingMode,
      catalogUnitGrossAmount,
    };
  });
}

function findNetForGross(gross: number): number {
  const approximate = roundDiv(BigInt(gross) * BigInt(100), BigInt(119));
  for (
    let candidate = Math.max(1, approximate - 3);
    candidate <= approximate + 3;
    candidate += 1
  ) {
    if (
      candidate + roundDiv(BigInt(candidate) * BigInt(19), BigInt(100)) ===
      gross
    ) {
      return candidate;
    }
  }
  throw new Error("DTE_CATALOG_PRICE_NOT_TAX_RECONCILABLE");
}

/**
 * Catalog prices are gross CLP amounts. Reconcile them at document level so
 * aggregate VAT rounding cannot change the amount actually paid.
 */
export function reconcileCatalogGrossLines(
  rawLines: readonly InvoiceDraftLineInput[],
): InvoiceDraftLineInput[] {
  const lines = validateInvoiceDraftLines(rawLines);
  const catalog = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.pricingMode === "catalog_gross");
  if (!catalog.length) return lines;

  const manualNet = lines
    .filter((line) => line.pricingMode !== "catalog_gross")
    .reduce((sum, line) => {
      const base = line.quantity * line.unitNetAmount;
      const discount = roundDiv(
        BigInt(base) * BigInt(line.discountBasisPoints ?? 0),
        BigInt(10_000),
      );
      return sum + base - discount;
    }, 0);
  const catalogGross = catalog.reduce(
    (sum, { line }) =>
      sum + line.quantity * Number(line.catalogUnitGrossAmount),
    0,
  );
  if (!Number.isSafeInteger(catalogGross) || catalogGross < 1) {
    throw new Error("DTE_CATALOG_GROSS_INVALID");
  }
  const manualTotal =
    manualNet + roundDiv(BigInt(manualNet) * BigInt(19), BigInt(100));
  const documentNet = findNetForGross(catalogGross + manualTotal);
  const catalogNet = documentNet - manualNet;
  if (catalogNet < catalog.length) {
    throw new Error("DTE_CATALOG_PRICE_NOT_TAX_RECONCILABLE");
  }

  const allocations = catalog.map(({ line, index }) => {
    const lineGross = line.quantity * Number(line.catalogUnitGrossAmount);
    const numerator = BigInt(lineGross) * BigInt(catalogNet);
    return {
      index,
      quantity: line.quantity,
      lineGross,
      net: Number(numerator / BigInt(catalogGross)),
      remainder: numerator % BigInt(catalogGross),
    };
  });
  let missing = catalogNet - allocations.reduce((sum, item) => sum + item.net, 0);
  allocations
    .slice()
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    )
    .forEach((item) => {
      if (missing > 0) {
        allocations.find((candidate) => candidate.index === item.index)!.net += 1;
        missing -= 1;
      }
    });
  if (missing !== 0) throw new Error("DTE_CATALOG_PRICE_NOT_TAX_RECONCILABLE");

  const result = lines.map((line) => ({ ...line }));
  for (const allocation of allocations) {
    if (allocation.net % allocation.quantity !== 0) {
      throw new Error("DTE_CATALOG_PRICE_NOT_TAX_RECONCILABLE");
    }
    result[allocation.index].unitNetAmount = allocation.net / allocation.quantity;
  }
  return result;
}

export function calculateInvoiceTotals(
  rawLines: readonly InvoiceDraftLineInput[],
): InvoiceTotals {
  const lines = reconcileCatalogGrossLines(rawLines);
  const calculated = calculateDteTaxTotals({
    lines: lines.map((line) => ({
      name: line.description,
      quantity: line.quantity,
      unitPrice: line.unitNetAmount,
      discountPercent: (line.discountBasisPoints ?? 0) / 100,
    })),
  });

  const catalogTax = lines.reduce((sum, line, index) => {
    if (line.pricingMode !== "catalog_gross") return sum;
    return (
      sum +
      line.quantity * Number(line.catalogUnitGrossAmount) -
      calculated.lines[index].montoItem
    );
  }, 0);
  const manualIndexes = lines
    .map((line, index) => (line.pricingMode === "manual_net" ? index : -1))
    .filter((index) => index >= 0);
  let allocatedManualTax = 0;
  const resultLines = calculated.lines.map((line, index): CalculatedInvoiceLine => {
    const original = lines[index];
    const isCatalog = original.pricingMode === "catalog_gross";
    const isLastManual = index === manualIndexes.at(-1);
    const lineTax = isCatalog
      ? original.quantity * Number(original.catalogUnitGrossAmount) -
        line.montoItem
      : isLastManual
        ? calculated.vatAmount - catalogTax - allocatedManualTax
        : roundDiv(BigInt(line.montoItem) * BigInt(19), BigInt(100));
    if (!isCatalog) allocatedManualTax += lineTax;
    return {
      ...original,
      position: index + 1,
      discountBasisPoints: original.discountBasisPoints ?? 0,
      discountAmount: line.discountAmount,
      netAmount: line.montoItem,
      taxAmount: lineTax,
      totalAmount: line.montoItem + lineTax,
    };
  });

  return {
    netAmount: calculated.netAmount,
    taxAmount: calculated.vatAmount,
    totalAmount: calculated.totalAmount,
    lines: resultLines,
  };
}

export function catalogGrossPriceToNet(grossAmount: number): number {
  const gross = safeInteger(grossAmount, "DTE_CATALOG_GROSS", 1);
  return findNetForGross(gross);
}

function requiredText(value: unknown, field: string, max = 180): string {
  const parsed = String(value ?? "").trim().slice(0, max);
  if (!parsed) throw new Error(`${field}_REQUIRED`);
  return parsed;
}

export function validateTaxIdentity(
  value: Partial<TaxIdentity> | null | undefined,
  prefix: "ISSUER" | "RECIPIENT",
): TaxIdentity {
  return {
    rut: requiredText(value?.rut, `DTE_${prefix}_RUT`, 32),
    legalName: requiredText(value?.legalName, `DTE_${prefix}_LEGAL_NAME`),
    businessActivity: requiredText(
      value?.businessActivity,
      `DTE_${prefix}_ACTIVITY`,
    ),
    address: requiredText(value?.address, `DTE_${prefix}_ADDRESS`),
    commune: requiredText(value?.commune, `DTE_${prefix}_COMMUNE`, 100),
    city: requiredText(value?.city, `DTE_${prefix}_CITY`, 100),
    email: value?.email ? String(value.email).trim().slice(0, 254) : null,
  };
}

export function createFinalTaxSnapshot(input: {
  issuer: Partial<TaxIdentity> | null | undefined;
  recipient: Partial<TaxIdentity> | null | undefined;
  now?: string;
}): FinalTaxSnapshot {
  return {
    issuer: validateTaxIdentity(input.issuer, "ISSUER"),
    recipient: validateTaxIdentity(input.recipient, "RECIPIENT"),
    capturedAt: input.now ?? new Date().toISOString(),
  };
}

type PaymentSignal = {
  tenantId: string;
  paymentId: string;
  paymentKey: string;
  amount: number;
  currency: string;
  confirmed: boolean;
  fullPayment: boolean;
  lines: InvoiceDraftLineInput[];
  issuer: Partial<TaxIdentity> | null;
  recipient: Partial<TaxIdentity> | null;
};

type PaymentDraft = {
  id: string;
  tenantId: string;
  paymentId: string;
  status: InvoiceDraftStatus;
  totals: InvoiceTotals;
  taxPreview: FinalTaxSnapshot | null;
  finalTaxSnapshot: FinalTaxSnapshot | null;
  folio: null;
  enqueueCount: number;
  activeIntentCount: number;
  executableOutboxCount: number;
  supersededIntentExecutable: boolean;
};

export class InMemoryPaymentInvoiceCoordinator {
  private readonly draftsByKey = new Map<string, PaymentDraft>();

  confirmPayment(input: PaymentSignal, automaticIssuanceEnabled: boolean): PaymentDraft {
    if (!input.confirmed || !input.fullPayment) {
      throw new Error("DTE_PAYMENT_NOT_ELIGIBLE");
    }
    if (input.currency !== "CLP") throw new Error("DTE_CURRENCY_NOT_SUPPORTED");
    const totals = calculateInvoiceTotals(input.lines);
    if (totals.totalAmount !== safeInteger(input.amount, "DTE_PAYMENT_AMOUNT", 1)) {
      throw new Error("DTE_PAYMENT_AMOUNT_MISMATCH");
    }
    const key = `${input.tenantId}|${input.paymentKey}|33`;
    const existing = this.draftsByKey.get(key);
    if (existing) return structuredClone(existing);

    let taxPreview: FinalTaxSnapshot | null = null;
    try {
      taxPreview = createFinalTaxSnapshot({
        issuer: input.issuer,
        recipient: input.recipient,
      });
    } catch {
      taxPreview = null;
    }
    const draft: PaymentDraft = {
      id: `draft_${key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 24)}`,
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      status: automaticIssuanceEnabled && taxPreview ? "QUEUED" : "REVIEW_REQUIRED",
      totals,
      taxPreview,
      finalTaxSnapshot: automaticIssuanceEnabled ? taxPreview : null,
      folio: null,
      enqueueCount: automaticIssuanceEnabled && taxPreview ? 1 : 0,
      activeIntentCount: 1,
      executableOutboxCount: automaticIssuanceEnabled && taxPreview ? 1 : 0,
      supersededIntentExecutable: false,
    };
    this.draftsByKey.set(key, draft);
    return structuredClone(draft);
  }

  draftCount(): number {
    return this.draftsByKey.size;
  }

  reviewManually(
    tenantId: string,
    paymentKey: string,
    currentIssuer: Partial<TaxIdentity>,
    currentRecipient: Partial<TaxIdentity>,
  ): PaymentDraft {
    const key = `${tenantId}|${paymentKey}|33`;
    const draft = this.draftsByKey.get(key);
    if (!draft) throw new Error("DTE_INVOICE_DRAFT_NOT_FOUND");
    if (draft.status === "QUEUED") return structuredClone(draft);
    draft.finalTaxSnapshot = createFinalTaxSnapshot({
      issuer: currentIssuer,
      recipient: currentRecipient,
    });
    draft.status = "QUEUED";
    draft.enqueueCount = 1;
    draft.activeIntentCount = 1;
    draft.executableOutboxCount = 1;
    draft.supersededIntentExecutable = false;
    return structuredClone(draft);
  }

  attemptSupersededIntent(
    tenantId: string,
    paymentKey: string,
  ): PaymentDraft {
    const draft = this.draftsByKey.get(`${tenantId}|${paymentKey}|33`);
    if (!draft) throw new Error("DTE_INVOICE_DRAFT_NOT_FOUND");
    return structuredClone(draft);
  }
}
