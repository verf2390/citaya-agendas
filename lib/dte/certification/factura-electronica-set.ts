import type { DteDocumentType } from "../dte-types";
import {
  calculateDteTaxTotals,
  type DteCalculatedLine,
  type DteExpectedTotals,
  type DteGlobalDiscountInput,
  type DteTaxCalculationResult,
  type DteTaxLineInput,
} from "./dte-tax-engine";

export type FacturaCertificationStatus = "PRE_CAF_NOT_READY";
export type FacturaCertificationCaseId =
  | "4959698-1"
  | "4959698-2"
  | "4959698-3"
  | "4959698-4"
  | "4959698-5"
  | "4959698-6"
  | "4959698-7"
  | "4959698-8";

export type FacturaCertificationAction =
  | {
      type: "text_correction";
      sourceCaseId: "4959698-1";
      codRef: 2;
      requiredFields: readonly ["previousBusinessActivity", "correctedBusinessActivity"];
    }
  | {
      type: "partial_return";
      sourceCaseId: "4959698-2";
      codRef: 3;
      returnedLines: ReadonlyArray<{ sourceLineName: string; quantity: number }>;
    }
  | {
      type: "full_annulment";
      sourceCaseId: "4959698-3";
      codRef: 1;
    }
  | {
      type: "annul_credit_note";
      sourceCaseId: "4959698-5";
      codRef: 1;
    };

export type FacturaCertificationBasicCase = {
  id: FacturaCertificationCaseId;
  attention: "4959698";
  documentType: DteDocumentType;
  title: string;
  lines?: readonly DteTaxLineInput[];
  globalDiscount?: DteGlobalDiscountInput;
  referenceReason?: string;
  expectedTotals?: DteExpectedTotals;
  action?: FacturaCertificationAction;
  calculationPhase: "PRE_CAF_1" | "PRE_CAF_2" | "PENDING";
};

export type FacturaCertificationReference = {
  kind: "set" | "specific";
  tpoDocRef: "SET" | "33" | "56" | "61";
  folioRef?: "PENDING_REAL_FOLIO";
  fchRef?: string;
  codRef?: 1 | 2 | 3;
  razonRef: string;
};

export type FacturaCertificationDocument = {
  caseId: FacturaCertificationCaseId;
  documentType: DteDocumentType;
  documentTypeCode: 33 | 56 | 61;
  issueDate: string;
  taxPeriod: string;
  lines: DteCalculatedLine[];
  references: FacturaCertificationReference[];
  action?: FacturaCertificationAction["type"];
  totals: DteTaxCalculationResult;
  textCorrectionDetail?: {
    previousBusinessActivity: string;
    correctedBusinessActivity: string;
    lineDescription: string;
  };
};

export type FacturaCertificationBuildInput = {
  issueDate?: string;
  taxPeriod?: string;
  caseOrder?: readonly FacturaCertificationCaseId[];
  textCorrection?: {
    previousBusinessActivity?: string | null;
    correctedBusinessActivity?: string | null;
  };
};

export type SalesBookCertificationSet = {
  attention: "4959699";
  source: "basic_set_4959698";
  expectedDocuments: {
    facturaAfecta: 4;
    notaCredito: 3;
    notaDebito: 1;
  };
  calculationPhase: "PENDING";
};

export type PurchaseBookCertificationSet = {
  attention: "4959700";
  calculationPhase: "PENDING";
  entries: ReadonlyArray<{
    documentLabel: string;
    folio: number;
    observation: string;
    affectedAmount?: number;
    exemptAmount?: number;
    commonVatProportionality?: "0.60";
  }>;
};

export type FacturaElectronicaCertificationManifest = {
  basicAttention: "4959698";
  salesBookAttention: "4959699";
  purchaseBookAttention: "4959700";
  obtainedAt: "2026-07-19";
  environment: "certification";
  status: FacturaCertificationStatus;
  annulledSets: {
    guiaDespacho: "anulado";
    facturaExentaIndependiente: "anulado";
    libroGuias: "anulado";
  };
  basicCases: readonly FacturaCertificationBasicCase[];
  salesBook: SalesBookCertificationSet;
  purchaseBook: PurchaseBookCertificationSet;
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return value;
}

export const FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST = deepFreeze({
  basicAttention: "4959698",
  salesBookAttention: "4959699",
  purchaseBookAttention: "4959700",
  obtainedAt: "2026-07-19",
  environment: "certification",
  status: "PRE_CAF_NOT_READY",
  annulledSets: {
    guiaDespacho: "anulado",
    facturaExentaIndependiente: "anulado",
    libroGuias: "anulado",
  },
  basicCases: [
    {
      id: "4959698-1",
      attention: "4959698",
      documentType: "factura_afecta",
      title: "Tipo 33, Factura Electrónica",
      calculationPhase: "PRE_CAF_1",
      lines: [
        { name: "Cajón AFECTO", quantity: 118, unitPrice: 628 },
        { name: "Relleno AFECTO", quantity: 51, unitPrice: 976 },
      ],
      expectedTotals: { netAmount: 123880, exemptAmount: 0, vatAmount: 23537, totalAmount: 147417 },
    },
    {
      id: "4959698-2",
      attention: "4959698",
      documentType: "factura_afecta",
      title: "Tipo 33",
      calculationPhase: "PRE_CAF_1",
      lines: [
        { name: "Pañuelo AFECTO", quantity: 175, unitPrice: 1473, discountPercent: 3 },
        { name: "ITEM 2 AFECTO", quantity: 99, unitPrice: 538, discountPercent: 3 },
      ],
      expectedTotals: { netAmount: 301706, exemptAmount: 0, vatAmount: 57324, totalAmount: 359030 },
    },
    {
      id: "4959698-3",
      attention: "4959698",
      documentType: "factura_afecta",
      title: "Tipo 33, factura mixta",
      calculationPhase: "PRE_CAF_1",
      lines: [
        { name: "Pintura B&W AFECTO", quantity: 23, unitPrice: 1299 },
        { name: "ITEM 2 AFECTO", quantity: 139, unitPrice: 2915 },
        { name: "ITEM 3 SERVICIO EXENTO", quantity: 1, unitPrice: 34637, exempt: true },
      ],
      expectedTotals: { netAmount: 435062, exemptAmount: 34637, vatAmount: 82662, totalAmount: 552361 },
    },
    {
      id: "4959698-4",
      attention: "4959698",
      documentType: "factura_afecta",
      title: "Tipo 33, factura mixta",
      calculationPhase: "PRE_CAF_1",
      lines: [
        { name: "ITEM 1 AFECTO", quantity: 43, unitPrice: 1185 },
        { name: "ITEM 2 AFECTO", quantity: 19, unitPrice: 739 },
        { name: "ITEM 3 SERVICIO EXENTO", quantity: 2, unitPrice: 6760, exempt: true },
      ],
      globalDiscount: { percent: 5, appliesTo: "affected" },
      expectedTotals: { netAmount: 61746, exemptAmount: 13520, vatAmount: 11732, totalAmount: 86998 },
    },
    {
      id: "4959698-5",
      attention: "4959698",
      documentType: "nota_credito",
      title: "Tipo 61, Nota de Crédito",
      calculationPhase: "PRE_CAF_2",
      referenceReason: "CORRIGE GIRO DEL RECEPTOR",
      action: {
        type: "text_correction",
        sourceCaseId: "4959698-1",
        codRef: 2,
        requiredFields: ["previousBusinessActivity", "correctedBusinessActivity"],
      },
    },
    {
      id: "4959698-6",
      attention: "4959698",
      documentType: "nota_credito",
      title: "Tipo 61",
      calculationPhase: "PRE_CAF_2",
      referenceReason: "DEVOLUCION DE MERCADERIAS",
      action: {
        type: "partial_return",
        sourceCaseId: "4959698-2",
        codRef: 3,
        returnedLines: [
          { sourceLineName: "Pañuelo AFECTO", quantity: 64 },
          { sourceLineName: "ITEM 2 AFECTO", quantity: 67 },
        ],
      },
      expectedTotals: { netAmount: 126409, exemptAmount: 0, vatAmount: 24018, totalAmount: 150427 },
    },
    {
      id: "4959698-7",
      attention: "4959698",
      documentType: "nota_credito",
      title: "Tipo 61",
      calculationPhase: "PRE_CAF_2",
      referenceReason: "ANULA FACTURA",
      action: {
        type: "full_annulment",
        sourceCaseId: "4959698-3",
        codRef: 1,
      },
      expectedTotals: { netAmount: 435062, exemptAmount: 34637, vatAmount: 82662, totalAmount: 552361 },
    },
    {
      id: "4959698-8",
      attention: "4959698",
      documentType: "nota_debito",
      title: "Tipo 56, Nota de Débito",
      calculationPhase: "PRE_CAF_2",
      referenceReason: "ANULA NOTA DE CREDITO ELECTRONICA",
      action: {
        type: "annul_credit_note",
        sourceCaseId: "4959698-5",
        codRef: 1,
      },
      expectedTotals: { netAmount: 0, exemptAmount: 0, vatAmount: 0, totalAmount: 0 },
    },
  ],
  salesBook: {
    attention: "4959699",
    source: "basic_set_4959698",
    expectedDocuments: {
      facturaAfecta: 4,
      notaCredito: 3,
      notaDebito: 1,
    },
    calculationPhase: "PENDING",
  },
  purchaseBook: {
    attention: "4959700",
    calculationPhase: "PENDING",
    entries: [
      {
        documentLabel: "Factura",
        folio: 234,
        observation: "factura del giro con derecho a crédito",
        affectedAmount: 5031,
      },
      {
        documentLabel: "Factura electrónica",
        folio: 32,
        observation: "factura del giro con derecho a crédito",
        exemptAmount: 7933,
        affectedAmount: 4010,
      },
      {
        documentLabel: "Factura",
        folio: 781,
        observation: "factura con IVA de uso común",
        affectedAmount: 29589,
        commonVatProportionality: "0.60",
      },
      {
        documentLabel: "Nota de crédito",
        folio: 451,
        observation: "descuento a factura 234",
        affectedAmount: 2612,
      },
      {
        documentLabel: "Factura electrónica",
        folio: 67,
        observation: "entrega gratuita del proveedor",
        affectedAmount: 8952,
      },
      {
        documentLabel: "Factura de compra electrónica",
        folio: 9,
        observation: "compra con retención total del IVA",
        affectedAmount: 9037,
      },
      {
        documentLabel: "Nota de crédito",
        folio: 211,
        observation: "descuento a factura electrónica 32",
        affectedAmount: 2130,
      },
    ],
  },
} as const satisfies FacturaElectronicaCertificationManifest);

export function getPreCaf1BasicCases(): readonly FacturaCertificationBasicCase[] {
  return FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases.filter(
    (item) => item.calculationPhase === "PRE_CAF_1",
  );
}

export function getPreCaf2NoteCases(): readonly FacturaCertificationBasicCase[] {
  return FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases.filter(
    (item) => item.calculationPhase === "PRE_CAF_2",
  );
}

export function calculateFacturaCertificationCase(caseId: FacturaCertificationCaseId): DteTaxCalculationResult {
  const certificationCase: FacturaCertificationBasicCase | undefined = FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases.find(
    (item) => item.id === caseId,
  );
  if (!certificationCase) throw new Error(`Caso no encontrado: ${caseId}`);
  if (certificationCase.calculationPhase !== "PRE_CAF_1") {
    throw new Error(`Caso ${caseId} no pertenece a PRE-CAF 1`);
  }
  if (!certificationCase.lines || !certificationCase.expectedTotals) {
    throw new Error(`Caso ${caseId} no tiene lineas/totales esperados`);
  }
  return calculateDteTaxTotals({
    lines: certificationCase.lines,
    globalDiscount: certificationCase.globalDiscount,
    expectedTotals: certificationCase.expectedTotals,
  });
}

function getCaseOrThrow(caseId: FacturaCertificationCaseId): FacturaCertificationBasicCase {
  const certificationCase: FacturaCertificationBasicCase | undefined = FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases.find(
    (item) => item.id === caseId,
  );
  if (!certificationCase) throw new Error(`Caso no encontrado: ${caseId}`);
  return certificationCase;
}

function documentTypeCode(documentType: DteDocumentType): 33 | 56 | 61 {
  if (documentType === "factura_afecta") return 33;
  if (documentType === "nota_credito") return 61;
  if (documentType === "nota_debito") return 56;
  throw new Error(`Tipo DTE no soportado en set factura: ${documentType}`);
}

function setReference(caseId: FacturaCertificationCaseId): FacturaCertificationReference {
  return {
    kind: "set",
    tpoDocRef: "SET",
    razonRef: `CASO ${caseId}`,
  };
}

function specificReference(
  source: FacturaCertificationDocument,
  action: FacturaCertificationAction,
  reason: string,
): FacturaCertificationReference {
  return {
    kind: "specific",
    tpoDocRef: String(source.documentTypeCode) as "33" | "56" | "61",
    folioRef: "PENDING_REAL_FOLIO",
    fchRef: source.issueDate,
    codRef: action.codRef,
    razonRef: reason,
  };
}

function assertSameTaxPeriod(source: FacturaCertificationDocument, taxPeriod: string, caseId: FacturaCertificationCaseId): void {
  if (source.taxPeriod !== taxPeriod) {
    throw new Error(`Periodo tributario inconsistente para ${caseId}: origen=${source.taxPeriod} destino=${taxPeriod}`);
  }
}

function zeroTaxCalculation(lineName: string): DteTaxCalculationResult {
  return calculateDteTaxTotals({
    lines: [{ name: lineName, quantity: 1, unitPrice: 0 }],
    expectedTotals: { netAmount: 0, exemptAmount: 0, vatAmount: 0, totalAmount: 0 },
  });
}

function buildInvoiceDocument(
  certificationCase: FacturaCertificationBasicCase,
  issueDate: string,
  taxPeriod: string,
): FacturaCertificationDocument {
  if (!certificationCase.lines || !certificationCase.expectedTotals) {
    throw new Error(`Caso factura incompleto: ${certificationCase.id}`);
  }
  const totals = calculateDteTaxTotals({
    lines: certificationCase.lines,
    globalDiscount: certificationCase.globalDiscount,
    expectedTotals: certificationCase.expectedTotals,
  });
  return {
    caseId: certificationCase.id,
    documentType: certificationCase.documentType,
    documentTypeCode: documentTypeCode(certificationCase.documentType),
    issueDate,
    taxPeriod,
    lines: totals.lines,
    references: [setReference(certificationCase.id)],
    totals,
  };
}

function buildTextCorrectionDocument(
  certificationCase: FacturaCertificationBasicCase,
  source: FacturaCertificationDocument,
  action: Extract<FacturaCertificationAction, { type: "text_correction" }>,
  input: FacturaCertificationBuildInput,
  issueDate: string,
  taxPeriod: string,
): FacturaCertificationDocument {
  assertSameTaxPeriod(source, taxPeriod, certificationCase.id);
  validateFacturaCertificationActionSource(action, source, certificationCase.id);
  const previous = String(input.textCorrection?.previousBusinessActivity ?? "").trim();
  const corrected = String(input.textCorrection?.correctedBusinessActivity ?? "").trim();
  if (!previous || !corrected) {
    throw new Error("Caso 4959698-5 requiere giro anterior y giro corregido externos");
  }

  const lineDescription = `Donde dice: ${previous}. Debe decir: ${corrected}.`;
  const totals = zeroTaxCalculation(lineDescription);
  return {
    caseId: certificationCase.id,
    documentType: certificationCase.documentType,
    documentTypeCode: documentTypeCode(certificationCase.documentType),
    issueDate,
    taxPeriod,
    lines: totals.lines,
    references: [
      setReference(certificationCase.id),
      specificReference(source, action, certificationCase.referenceReason ?? ""),
    ],
    action: action.type,
    totals,
    textCorrectionDetail: {
      previousBusinessActivity: previous,
      correctedBusinessActivity: corrected,
      lineDescription,
    },
  };
}

export function validateFacturaCertificationActionSource(
  action: FacturaCertificationAction,
  source: Pick<FacturaCertificationDocument, "documentType" | "caseId">,
  destinationCaseId: FacturaCertificationCaseId,
): void {
  if (
    (action.type === "text_correction" || action.type === "partial_return" || action.type === "full_annulment") &&
    source.documentType !== "factura_afecta"
  ) {
    throw new Error(`Caso ${destinationCaseId} debe referenciar factura afecta`);
  }
  if (action.type === "annul_credit_note" && source.documentType !== "nota_credito") {
    throw new Error(`Caso ${destinationCaseId} debe referenciar nota de credito`);
  }
}

export function derivePartialReturnLines(
  action: Extract<FacturaCertificationAction, { type: "partial_return" }>,
  sourceCase: Pick<FacturaCertificationBasicCase, "id" | "lines">,
): DteTaxLineInput[] {
  if (!sourceCase.lines) throw new Error(`Factura origen ${sourceCase.id} sin lineas`);
  return action.returnedLines.map((returned) => {
    const extraKeys = Object.keys(returned).filter((key) => key !== "sourceLineName" && key !== "quantity");
    if (extraKeys.length > 0) {
      throw new Error(`La devolucion no puede sustituir manualmente precio o descuento: ${extraKeys.join(", ")}`);
    }
    const originalLine = sourceCase.lines?.find((line) => line.name === returned.sourceLineName);
    if (!originalLine) throw new Error(`Linea de devolucion no existe en factura origen: ${returned.sourceLineName}`);
    if (returned.quantity > originalLine.quantity) {
      throw new Error(`No se puede devolver mas cantidad que la factura original: ${returned.sourceLineName}`);
    }
    return {
      name: originalLine.name,
      quantity: returned.quantity,
      unitPrice: originalLine.unitPrice,
      exempt: originalLine.exempt,
      discountPercent: originalLine.discountPercent,
    };
  });
}

function buildPartialReturnDocument(
  certificationCase: FacturaCertificationBasicCase,
  source: FacturaCertificationDocument,
  action: Extract<FacturaCertificationAction, { type: "partial_return" }>,
  issueDate: string,
  taxPeriod: string,
): FacturaCertificationDocument {
  assertSameTaxPeriod(source, taxPeriod, certificationCase.id);
  validateFacturaCertificationActionSource(action, source, certificationCase.id);
  const sourceCase = getCaseOrThrow(action.sourceCaseId);
  const returnedLines = derivePartialReturnLines(action, sourceCase);

  const totals = calculateDteTaxTotals({
    lines: returnedLines,
    expectedTotals: certificationCase.expectedTotals,
  });
  return {
    caseId: certificationCase.id,
    documentType: certificationCase.documentType,
    documentTypeCode: documentTypeCode(certificationCase.documentType),
    issueDate,
    taxPeriod,
    lines: totals.lines,
    references: [
      setReference(certificationCase.id),
      specificReference(source, action, certificationCase.referenceReason ?? ""),
    ],
    action: action.type,
    totals,
  };
}

function buildFullAnnulmentDocument(
  certificationCase: FacturaCertificationBasicCase,
  source: FacturaCertificationDocument,
  action: Extract<FacturaCertificationAction, { type: "full_annulment" }>,
  issueDate: string,
  taxPeriod: string,
): FacturaCertificationDocument {
  assertSameTaxPeriod(source, taxPeriod, certificationCase.id);
  validateFacturaCertificationActionSource(action, source, certificationCase.id);
  const totals = calculateDteTaxTotals({
    lines: source.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      exempt: line.exempt,
      discountPercent: line.discountPercent,
    })),
    globalDiscount: source.totals.globalDiscount
      ? { percent: source.totals.globalDiscount.discountPercent, appliesTo: "affected" }
      : undefined,
    expectedTotals: certificationCase.expectedTotals,
  });
  return {
    caseId: certificationCase.id,
    documentType: certificationCase.documentType,
    documentTypeCode: documentTypeCode(certificationCase.documentType),
    issueDate,
    taxPeriod,
    lines: totals.lines,
    references: [
      setReference(certificationCase.id),
      specificReference(source, action, certificationCase.referenceReason ?? ""),
    ],
    action: action.type,
    totals,
  };
}

function buildAnnulCreditNoteDocument(
  certificationCase: FacturaCertificationBasicCase,
  source: FacturaCertificationDocument,
  action: Extract<FacturaCertificationAction, { type: "annul_credit_note" }>,
  issueDate: string,
  taxPeriod: string,
): FacturaCertificationDocument {
  assertSameTaxPeriod(source, taxPeriod, certificationCase.id);
  validateFacturaCertificationActionSource(action, source, certificationCase.id);
  const totals = calculateDteTaxTotals({
    lines: source.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      exempt: line.exempt,
      discountPercent: line.discountPercent,
    })),
    expectedTotals: certificationCase.expectedTotals,
  });
  return {
    caseId: certificationCase.id,
    documentType: certificationCase.documentType,
    documentTypeCode: documentTypeCode(certificationCase.documentType),
    issueDate,
    taxPeriod,
    lines: totals.lines,
    references: [
      setReference(certificationCase.id),
      specificReference(source, action, certificationCase.referenceReason ?? ""),
    ],
    action: action.type,
    totals,
  };
}

function buildNoteDocument(
  certificationCase: FacturaCertificationBasicCase,
  builtDocuments: Map<FacturaCertificationCaseId, FacturaCertificationDocument>,
  input: FacturaCertificationBuildInput,
  issueDate: string,
  taxPeriod: string,
): FacturaCertificationDocument {
  const action = certificationCase.action;
  if (!action) throw new Error(`Caso ${certificationCase.id} no tiene accion semantica`);
  const source = builtDocuments.get(action.sourceCaseId);
  if (!source) {
    throw new Error(`No se puede generar ${certificationCase.id} antes de su documento origen ${action.sourceCaseId}`);
  }
  if (!source.issueDate) throw new Error(`Documento origen ${source.caseId} sin fecha de referencia`);

  if (action.type === "text_correction") {
    return buildTextCorrectionDocument(certificationCase, source, action, input, issueDate, taxPeriod);
  }
  if (action.type === "partial_return") {
    return buildPartialReturnDocument(certificationCase, source, action, issueDate, taxPeriod);
  }
  if (action.type === "full_annulment") {
    return buildFullAnnulmentDocument(certificationCase, source, action, issueDate, taxPeriod);
  }
  return buildAnnulCreditNoteDocument(certificationCase, source, action, issueDate, taxPeriod);
}

export function buildFacturaCertificationDocuments(
  input: FacturaCertificationBuildInput = {},
): FacturaCertificationDocument[] {
  const issueDate = input.issueDate ?? "2026-07-19";
  const taxPeriod = input.taxPeriod ?? issueDate.slice(0, 7);
  if (!issueDate.startsWith(taxPeriod)) {
    throw new Error(`Fecha ${issueDate} no pertenece al periodo tributario ${taxPeriod}`);
  }
  const order = input.caseOrder ?? FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases.map((item) => item.id);
  const built = new Map<FacturaCertificationCaseId, FacturaCertificationDocument>();
  const documents: FacturaCertificationDocument[] = [];

  for (const caseId of order) {
    const certificationCase = getCaseOrThrow(caseId);
    const document = certificationCase.calculationPhase === "PRE_CAF_1"
      ? buildInvoiceDocument(certificationCase, issueDate, taxPeriod)
      : buildNoteDocument(certificationCase, built, input, issueDate, taxPeriod);
    built.set(caseId, document);
    documents.push(document);
  }

  const expectedOrder = FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases.map((item) => item.id);
  if (order.length === expectedOrder.length && order.some((caseId, index) => caseId !== expectedOrder[index])) {
    throw new Error("El orden completo del set debe ser 4959698-1 a 4959698-8");
  }

  for (const document of documents) {
    const specificReferences = document.references.filter((reference) => reference.kind === "specific");
    if ((document.references[0]?.kind !== "set") || document.references[0].tpoDocRef !== "SET") {
      throw new Error(`Caso ${document.caseId} debe conservar referencia SET como primera referencia`);
    }
    if (document.action && specificReferences.length !== 1) {
      throw new Error(`Caso ${document.caseId} debe tener exactamente una referencia tributaria especifica`);
    }
    if (
      document.action &&
      (specificReferences[0]?.codRef === 1 || specificReferences[0]?.codRef === 2) &&
      specificReferences.length !== 1
    ) {
      throw new Error(`Caso ${document.caseId} CodRef ${specificReferences[0]?.codRef} permite solo una referencia especifica`);
    }
  }

  return documents;
}
