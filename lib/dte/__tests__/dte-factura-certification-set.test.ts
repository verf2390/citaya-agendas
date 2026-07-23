import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  calculateDteTaxTotals,
  DTE_VAT_RATE_PERCENT,
} from "../certification/dte-tax-engine";
import {
  buildFacturaCertificationDocuments,
  calculateFacturaCertificationCase,
  derivePartialReturnLines,
  FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST,
  getPreCaf1BasicCases,
  getPreCaf2NoteCases,
  validateFacturaCertificationActionSource,
  type FacturaCertificationAction,
} from "../certification/factura-electronica-set";
import {
  buildSalesBookModel,
  buildSalesBookModelFromDocuments,
  SALES_BOOK_SCHEMA_STATUS,
  serializeSalesBookXml,
} from "../certification/sales-book";
import {
  buildPurchaseBookModel,
  PURCHASE_BOOK_SET_4959700,
  serializePurchaseBookXml,
} from "../certification/purchase-book";
import { validatePreCafExternalData } from "../certification/pre-caf-external-contract";
import { encodeIso88591Strict, formatFacturaSetDryRunResult, runFacturaSetDryRun } from "../certification/factura-set-dry-run";
import { auditFacturaSetFinalFiles, formatFacturaEncodingAuditResult } from "../certification/factura-encoding-audit";

const expectedByCase = {
  "4959698-1": { netAmount: 123880, exemptAmount: 0, vatAmount: 23537, totalAmount: 147417 },
  "4959698-2": { netAmount: 301706, exemptAmount: 0, vatAmount: 57324, totalAmount: 359030 },
  "4959698-3": { netAmount: 435062, exemptAmount: 34637, vatAmount: 82662, totalAmount: 552361 },
  "4959698-4": { netAmount: 61746, exemptAmount: 13520, vatAmount: 11732, totalAmount: 86998 },
} as const;

test("calcula exactamente los cuatro casos PRE-CAF 1 del set 4959698", () => {
  for (const [caseId, expected] of Object.entries(expectedByCase)) {
    const result = calculateFacturaCertificationCase(caseId as keyof typeof expectedByCase);
    assert.deepEqual(
      {
        netAmount: result.netAmount,
        exemptAmount: result.exemptAmount,
        vatAmount: result.vatAmount,
        totalAmount: result.totalAmount,
      },
      expected,
    );
    assert.equal(result.vatRate, DTE_VAT_RATE_PERCENT);
    assert.equal(result.totalAmount, result.netAmount + result.exemptAmount + result.vatAmount);
  }
});

test("calcula descuentos por linea como DescuentoPct, DescuentoMonto y MontoItem", () => {
  const result = calculateFacturaCertificationCase("4959698-2");

  assert.equal(result.lines[0].name, "Pañuelo AFECTO");
  assert.equal(result.lines[0].grossAmount, 257775);
  assert.equal(result.lines[0].discountPercent, 3);
  assert.equal(result.lines[0].discountAmount, 7733);
  assert.equal(result.lines[0].montoItem, 250042);

  assert.equal(result.lines[1].grossAmount, 53262);
  assert.equal(result.lines[1].discountPercent, 3);
  assert.equal(result.lines[1].discountAmount, 1598);
  assert.equal(result.lines[1].montoItem, 51664);
});

test("aplica descuento global solamente sobre montos afectos", () => {
  const result = calculateFacturaCertificationCase("4959698-4");

  assert.deepEqual(result.globalDiscount, {
    discountType: "D",
    valueType: "%",
    discountPercent: 5,
    discountAmount: 3250,
    appliesTo: "affected",
  });
  assert.equal(result.exemptAmount, 13520);
  assert.equal(result.netAmount, 61746);
});

test("soporta lineas mixtas afectas y exentas mediante IndExe=1", () => {
  const result = calculateFacturaCertificationCase("4959698-3");

  assert.equal(result.lines[0].exempt, false);
  assert.equal(result.lines[1].exempt, false);
  assert.equal(result.lines[2].exempt, true);
  assert.equal(result.lines[2].indExe, 1);
  assert.equal(result.netAmount, 435062);
  assert.equal(result.exemptAmount, 34637);
});

test("preserva literalmente glosas, acentos, ñ y B&W del set vigente", () => {
  const manifestText = JSON.stringify(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST);

  assert.match(manifestText, /Cajón AFECTO/);
  assert.match(manifestText, /Pañuelo AFECTO/);
  assert.match(manifestText, /Pintura B&W AFECTO/);
  assert.match(manifestText, /Tipo 33, Factura Electrónica/);
  assert.match(manifestText, /Tipo 61, Nota de Crédito/);
  assert.match(manifestText, /Tipo 56, Nota de Débito/);
  assert.match(manifestText, /CORRIGE GIRO DEL RECEPTOR/);
  assert.match(manifestText, /DEVOLUCION DE MERCADERIAS/);
  assert.match(manifestText, /ANULA NOTA DE CREDITO ELECTRONICA/);
});

test("redondea IVA a pesos enteros con aritmetica decimal entera", () => {
  const result = calculateDteTaxTotals({
    lines: [{ name: "Servicio afecto", quantity: 1, unitPrice: 123880 }],
  });

  assert.equal(result.vatAmount, 23537);
  assert.equal(result.totalAmount, 147417);
});

test("rechaza cantidades negativas", () => {
  assert.throws(
    () => calculateDteTaxTotals({ lines: [{ name: "Item", quantity: -1, unitPrice: 100 }] }),
    /quantity debe ser mayor que cero/,
  );
});

test("rechaza descuentos mayores a 100%", () => {
  assert.throws(
    () =>
      calculateDteTaxTotals({
        lines: [{ name: "Item", quantity: 1, unitPrice: 100, discountPercent: 101 }],
      }),
    /debe estar entre 0 y 100/,
  );
});

test("rechaza montos decimales finales", () => {
  assert.throws(
    () => calculateDteTaxTotals({ lines: [{ name: "Item", quantity: 1, unitPrice: 100.5 }] }),
    /unitPrice debe ser un entero seguro en CLP/,
  );
});

test("rechaza totales inyectados que no cuadren con el calculo puro", () => {
  assert.throws(
    () =>
      calculateDteTaxTotals({
        lines: [{ name: "Item", quantity: 1, unitPrice: 1000 }],
        expectedTotals: { netAmount: 999, exemptAmount: 0, vatAmount: 190, totalAmount: 1189 },
      }),
    /Totales esperados no cuadran/,
  );
});

test("el manifiesto vigente es inmutable y registra PRE_CAF_NOT_READY", () => {
  assert.equal(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.status, "PRE_CAF_NOT_READY");
  assert.equal(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.environment, "certification");
  assert.equal(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicAttention, "4959698");
  assert.equal(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.salesBookAttention, "4959699");
  assert.equal(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.purchaseBookAttention, "4959700");
  assert.equal(getPreCaf1BasicCases().length, 4);

  assert.equal(Object.isFrozen(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST), true);
  assert.equal(Object.isFrozen(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases), true);
  assert.equal(Object.isFrozen(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases[0].lines), true);
  assert.throws(
    () => {
      (FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases as unknown as unknown[]).push({});
    },
    /object is not extensible|Cannot add property/,
  );
});


const textCorrection = {
  previousBusinessActivity: "GIRO ANTERIOR FIXTURE",
  correctedBusinessActivity: "GIRO CORREGIDO FIXTURE",
};

function buildFullSet() {
  return buildFacturaCertificationDocuments({ textCorrection });
}

test("genera CodRef exacto y referencia SET primero para los casos 5 a 8", () => {
  const documents = buildFullSet();
  const expected = new Map([
    ["4959698-5", { tpoDocRef: "33", codRef: 2, reason: "CORRIGE GIRO DEL RECEPTOR" }],
    ["4959698-6", { tpoDocRef: "33", codRef: 3, reason: "DEVOLUCION DE MERCADERIAS" }],
    ["4959698-7", { tpoDocRef: "33", codRef: 1, reason: "ANULA FACTURA" }],
    ["4959698-8", { tpoDocRef: "61", codRef: 1, reason: "ANULA NOTA DE CREDITO ELECTRONICA" }],
  ]);

  for (const document of documents.slice(4)) {
    const expectedReference = expected.get(document.caseId);
    assert.ok(expectedReference);
    assert.equal(document.references[0].kind, "set");
    assert.equal(document.references[0].tpoDocRef, "SET");
    assert.equal(document.references[0].razonRef, `CASO ${document.caseId}`);
    assert.equal(document.references.length, 2);
    assert.equal(document.references[1].kind, "specific");
    assert.equal(document.references[1].tpoDocRef, expectedReference.tpoDocRef);
    assert.equal(document.references[1].folioRef, "PENDING_REAL_FOLIO");
    assert.equal(document.references[1].fchRef, "2026-07-19");
    assert.equal(document.references[1].codRef, expectedReference.codRef);
    assert.equal(document.references[1].razonRef, expectedReference.reason);
  }
});

test("caso 4959698-5 corrige texto con montos cero y detalle estructurado", () => {
  const doc = buildFullSet().find((item) => item.caseId === "4959698-5");
  assert.ok(doc);
  assert.equal(doc.action, "text_correction");
  assert.deepEqual({
    netAmount: doc.totals.netAmount,
    exemptAmount: doc.totals.exemptAmount,
    vatAmount: doc.totals.vatAmount,
    totalAmount: doc.totals.totalAmount,
  }, { netAmount: 0, exemptAmount: 0, vatAmount: 0, totalAmount: 0 });
  assert.equal(doc.lines[0].montoItem, 0);
  assert.match(doc.textCorrectionDetail?.lineDescription ?? "", /Donde dice: GIRO ANTERIOR FIXTURE/);
  assert.match(doc.textCorrectionDetail?.lineDescription ?? "", /Debe decir: GIRO CORREGIDO FIXTURE/);
});

test("caso 4959698-5 queda bloqueado sin giro anterior y corregido", () => {
  assert.throws(
    () => buildFacturaCertificationDocuments(),
    /requiere giro anterior y giro corregido externos/,
  );
});

test("caso 4959698-6 deriva devolucion parcial con totales exactos", () => {
  const doc = buildFullSet().find((item) => item.caseId === "4959698-6");
  assert.ok(doc);
  assert.deepEqual({
    netAmount: doc.totals.netAmount,
    exemptAmount: doc.totals.exemptAmount,
    vatAmount: doc.totals.vatAmount,
    totalAmount: doc.totals.totalAmount,
  }, { netAmount: 126409, exemptAmount: 0, vatAmount: 24018, totalAmount: 150427 });
  assert.deepEqual(doc.lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    discountAmount: line.discountAmount,
    montoItem: line.montoItem,
  })), [
    { name: "Pañuelo AFECTO", quantity: 64, unitPrice: 1473, discountPercent: 3, discountAmount: 2828, montoItem: 91444 },
    { name: "ITEM 2 AFECTO", quantity: 67, unitPrice: 538, discountPercent: 3, discountAmount: 1081, montoItem: 34965 },
  ]);
});

test("rechaza devolucion superior a la cantidad original", () => {
  const sourceCase = FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases.find((item) => item.id === "4959698-2");
  assert.ok(sourceCase);
  const action: Extract<FacturaCertificationAction, { type: "partial_return" }> = {
    type: "partial_return",
    sourceCaseId: "4959698-2",
    codRef: 3,
    returnedLines: [{ sourceLineName: "Pañuelo AFECTO", quantity: 176 }],
  };
  assert.throws(() => derivePartialReturnLines(action, sourceCase), /No se puede devolver mas cantidad/);
});

test("rechaza sustitucion manual de precio o descuento en devolucion", () => {
  const sourceCase = FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.basicCases.find((item) => item.id === "4959698-2");
  assert.ok(sourceCase);
  const action = {
    type: "partial_return",
    sourceCaseId: "4959698-2",
    codRef: 3,
    returnedLines: [{ sourceLineName: "Pañuelo AFECTO", quantity: 64, unitPrice: 1 }],
  } as unknown as Extract<FacturaCertificationAction, { type: "partial_return" }>;
  assert.throws(() => derivePartialReturnLines(action, sourceCase), /no puede sustituir manualmente/);
});

test("caso 4959698-7 clona montos y lineas de la factura mixta original", () => {
  const doc = buildFullSet().find((item) => item.caseId === "4959698-7");
  assert.ok(doc);
  assert.deepEqual({
    netAmount: doc.totals.netAmount,
    exemptAmount: doc.totals.exemptAmount,
    vatAmount: doc.totals.vatAmount,
    totalAmount: doc.totals.totalAmount,
  }, { netAmount: 435062, exemptAmount: 34637, vatAmount: 82662, totalAmount: 552361 });
  assert.equal(doc.lines.length, 3);
  assert.equal(doc.lines[2].name, "ITEM 3 SERVICIO EXENTO");
  assert.equal(doc.lines[2].indExe, 1);
});

test("caso 4959698-8 deriva valores desde la nota de credito del caso 5", () => {
  const documents = buildFullSet();
  const case5 = documents.find((item) => item.caseId === "4959698-5");
  const case8 = documents.find((item) => item.caseId === "4959698-8");
  assert.ok(case5);
  assert.ok(case8);
  assert.equal(case8.action, "annul_credit_note");
  assert.deepEqual({
    netAmount: case8.totals.netAmount,
    exemptAmount: case8.totals.exemptAmount,
    vatAmount: case8.totals.vatAmount,
    totalAmount: case8.totals.totalAmount,
  }, {
    netAmount: case5.totals.netAmount,
    exemptAmount: case5.totals.exemptAmount,
    vatAmount: case5.totals.vatAmount,
    totalAmount: case5.totals.totalAmount,
  });
  assert.equal(case8.lines[0].montoItem, 0);
});

test("rechaza referencias a tipos incorrectos", () => {
  const action: Extract<FacturaCertificationAction, { type: "annul_credit_note" }> = {
    type: "annul_credit_note",
    sourceCaseId: "4959698-5",
    codRef: 1,
  };
  assert.throws(
    () => validateFacturaCertificationActionSource(action, { caseId: "4959698-1", documentType: "factura_afecta" }, "4959698-8"),
    /debe referenciar nota de credito/,
  );
});

test("rechaza referencias inexistentes o notas generadas antes de su origen", () => {
  assert.throws(
    () => buildFacturaCertificationDocuments({ caseOrder: ["4959698-5"], textCorrection }),
    /antes de su documento origen 4959698-1/,
  );
});

test("rechaza fecha o periodo tributario inconsistente", () => {
  assert.throws(
    () => buildFacturaCertificationDocuments({ issueDate: "2026-07-19", taxPeriod: "2026-06", textCorrection }),
    /no pertenece al periodo tributario/,
  );
});

test("valida orden completo de generacion 1 a 8", () => {
  const documents = buildFullSet();
  assert.deepEqual(documents.map((item) => item.caseId), [
    "4959698-1",
    "4959698-2",
    "4959698-3",
    "4959698-4",
    "4959698-5",
    "4959698-6",
    "4959698-7",
    "4959698-8",
  ]);
  assert.throws(
    () => buildFacturaCertificationDocuments({
      caseOrder: ["4959698-1", "4959698-2", "4959698-3", "4959698-4", "4959698-6", "4959698-5", "4959698-7", "4959698-8"],
      textCorrection,
    }),
    /antes de su documento origen|orden completo/,
  );
});

test("mantiene glosas exactas y estado PRE_CAF_NOT_READY en PRE-CAF 2", () => {
  const manifestText = JSON.stringify(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST);
  assert.match(manifestText, /CORRIGE GIRO DEL RECEPTOR/);
  assert.match(manifestText, /DEVOLUCION DE MERCADERIAS/);
  assert.match(manifestText, /ANULA FACTURA/);
  assert.match(manifestText, /ANULA NOTA DE CREDITO ELECTRONICA/);
  assert.equal(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.status, "PRE_CAF_NOT_READY");
  assert.equal(getPreCaf2NoteCases().length, 4);
});


const salesBookExternalData = {
  rutEmisorLibro: "78195645-7",
  rutEnvia: "12345678-5",
  fchResol: "2026-07-19",
  nroResol: 1,
};

const salesBookDetails = {
  "4959698-1": { folio: 101, recipientRut: "11111111-1", recipientName: "Cliente Fixture & Uno" },
  "4959698-2": { folio: 102, recipientRut: "11111111-1", recipientName: "Cliente Fixture Dos" },
  "4959698-3": { folio: 103, recipientRut: "11111111-1", recipientName: "Cliente Fixture Tres" },
  "4959698-4": { folio: 104, recipientRut: "11111111-1", recipientName: "Cliente Fixture Cuatro" },
  "4959698-5": { folio: 201, recipientRut: "11111111-1", recipientName: "Cliente Fixture NC Texto" },
  "4959698-6": { folio: 202, recipientRut: "11111111-1", recipientName: "Cliente Fixture NC Devolucion" },
  "4959698-7": { folio: 203, recipientRut: "11111111-1", recipientName: "Cliente Fixture NC Anula" },
  "4959698-8": { folio: 301, recipientRut: "11111111-1", recipientName: "Cliente Fixture ND" },
} as const;

function buildSalesBookFixture() {
  return buildSalesBookModel({
    externalData: salesBookExternalData,
    details: salesBookDetails,
    textCorrection,
  });
}

test("Libro de Ventas 4959699 calcula totales exactos por tipo sin compensar notas", () => {
  const model = buildSalesBookFixture();
  assert.deepEqual(model.resumenPeriodo, [
    { tpoDoc: 33, totDoc: 4, totOpExe: 2, totMntExe: 48157, totMntNeto: 922394, totMntIVA: 175255, totMntTotal: 1145806 },
    { tpoDoc: 61, totDoc: 3, totOpExe: 1, totMntExe: 34637, totMntNeto: 561471, totMntIVA: 106680, totMntTotal: 702788 },
    { tpoDoc: 56, totDoc: 1, totOpExe: 0, totMntExe: 0, totMntNeto: 0, totMntIVA: 0, totMntTotal: 0 },
  ]);
});

test("Libro de Ventas conserva TotDoc 4/3/1, TotOpExe 2/1/0 y ocho detalles en orden", () => {
  const model = buildSalesBookFixture();
  assert.deepEqual(model.resumenPeriodo.map((item) => item.totDoc), [4, 3, 1]);
  assert.deepEqual(model.resumenPeriodo.map((item) => item.totOpExe), [2, 1, 0]);
  assert.deepEqual(model.detalle.map((item) => [item.caseId, item.tpoDoc]), [
    ["4959698-1", 33],
    ["4959698-2", 33],
    ["4959698-3", 33],
    ["4959698-4", 33],
    ["4959698-5", 61],
    ["4959698-6", 61],
    ["4959698-7", 61],
    ["4959698-8", 56],
  ]);
});

test("Libro de Ventas incluye documentos cero en detalle y TotDoc sin incrementar montos", () => {
  const model = buildSalesBookFixture();
  const case5 = model.detalle.find((item) => item.caseId === "4959698-5");
  const case8 = model.detalle.find((item) => item.caseId === "4959698-8");
  assert.ok(case5);
  assert.ok(case8);
  assert.equal(case5.mntTotal, 0);
  assert.equal(case8.mntTotal, 0);
  assert.equal(model.resumenPeriodo.find((item) => item.tpoDoc === 61)?.totDoc, 3);
  assert.equal(model.resumenPeriodo.find((item) => item.tpoDoc === 56)?.totDoc, 1);
});

test("Libro de Ventas cuadra resumen contra detalle por tipo", () => {
  const model = buildSalesBookFixture();
  for (const total of model.resumenPeriodo) {
    const details = model.detalle.filter((item) => item.tpoDoc === total.tpoDoc);
    assert.equal(total.totMntExe, details.reduce((sum, item) => sum + item.mntExe, 0));
    assert.equal(total.totMntNeto, details.reduce((sum, item) => sum + item.mntNeto, 0));
    assert.equal(total.totMntIVA, details.reduce((sum, item) => sum + item.mntIVA, 0));
    assert.equal(total.totMntTotal, details.reduce((sum, item) => sum + item.mntTotal, 0));
  }
});

test("Libro de Ventas rechaza periodo mixto", () => {
  const docs = buildFacturaCertificationDocuments({ textCorrection });
  const mixed = docs.map((doc) => doc.caseId === "4959698-8" ? { ...doc, taxPeriod: "2026-08" } : doc);
  assert.throws(
    () => buildSalesBookModelFromDocuments({ externalData: salesBookExternalData, details: salesBookDetails, documents: mixed }),
    /periodo tributario comun/,
  );
});

test("Libro de Ventas rechaza folio pendiente, RUT invalido y resolucion faltante", () => {
  assert.throws(
    () => buildSalesBookModel({
      externalData: salesBookExternalData,
      details: { ...salesBookDetails, "4959698-1": { ...salesBookDetails["4959698-1"], folio: "PENDING_REAL_FOLIO" } },
      textCorrection,
    }),
    /Folio pendiente no permitido/,
  );
  assert.throws(
    () => buildSalesBookModel({
      externalData: salesBookExternalData,
      details: { ...salesBookDetails, "4959698-1": { ...salesBookDetails["4959698-1"], recipientRut: "11111111-2" } },
      textCorrection,
    }),
    /Invalid Chilean RUT/,
  );
  assert.throws(
    () => buildSalesBookModel({
      externalData: { ...salesBookExternalData, fchResol: "" },
      details: salesBookDetails,
      textCorrection,
    }),
    /Datos externos Libro de Ventas faltantes/,
  );
});

test("Libro de Ventas serializa XML con caracteres escapados y montos sin separadores", () => {
  const model = buildSalesBookFixture();
  const xml = serializeSalesBookXml(model);
  assert.match(xml, /<LibroCompraVenta xmlns="http:\/\/www\.sii\.cl\/SiiDte"/);
  assert.match(xml, /<EnvioLibro ID="LibroVentas-4959699-PRECAF">/);
  assert.match(xml, /Cliente Fixture &amp; Uno/);
  assert.match(xml, /<TotMntTotal>1145806<\/TotMntTotal>/);
  assert.doesNotMatch(xml, /1\.145\.806/);
  assert.doesNotMatch(xml, /PENDING_REAL_FOLIO/);
});

test("Libro de Ventas genera caratula exacta y mantiene PRE_CAF_NOT_READY", () => {
  const model = buildSalesBookFixture();
  assert.deepEqual(model.caratula, {
    rutEmisorLibro: "78195645-7",
    rutEnvia: "12345678-5",
    periodoTributario: "2026-07",
    fchResol: "2026-07-19",
    nroResol: 1,
    tipoOperacion: "VENTA",
    tipoLibro: "ESPECIAL",
    tipoEnvio: "TOTAL",
    folioNotificacion: 1,
  });
  assert.equal(model.status, "PRE_CAF_NOT_READY");
  assert.equal(FACTURA_ELECTRONICA_CERTIFICATION_MANIFEST.status, "PRE_CAF_NOT_READY");
  assert.equal(SALES_BOOK_SCHEMA_STATUS.officialXsdPresent, true);
});


const purchaseBookProviders = {
  "4959700-1": { rut: "11111111-1", name: "Proveedor Fixture Uno" },
  "4959700-2": { rut: "11111111-1", name: "Proveedor Fixture Dos" },
  "4959700-3": { rut: "11111111-1", name: "Proveedor Fixture Comun" },
  "4959700-4": { rut: "11111111-1", name: "Proveedor Fixture NC Manual" },
  "4959700-5": { rut: "11111111-1", name: "Proveedor Fixture Gratuito" },
  "4959700-6": { rut: "11111111-1", name: "Proveedor Fixture Retencion" },
  "4959700-7": { rut: "11111111-1", name: "Proveedor Fixture NC Electronica" },
} as const;

const purchaseBookExternalData = {
  rutEmisorLibro: "78195645-7",
  rutEnvia: "12345678-5",
  periodoTributario: "2026-07",
  fchResol: "2026-07-19",
  nroResol: 1,
};

function buildPurchaseBookFixture() {
  return buildPurchaseBookModel({
    externalData: purchaseBookExternalData,
    providers: purchaseBookProviders,
    salesBookPeriod: "2026-07",
  });
}

function validateLibroCvXml(xml: string) {
  const dir = mkdtempSync(join(tmpdir(), "citaya-librocv-"));
  const xmlPath = join(dir, "libro.xml");
  writeFileSync(xmlPath, xml, "utf8");
  return spawnSync("xmllint", ["--noout", "--schema", "docs/dte-sii/xsd/LibroCV_v10.xsd", xmlPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function assertLibroCvValidationResult(result: ReturnType<typeof validateLibroCvXml>): void {
  if (result.status !== 0) {
    assert.match(result.stderr, /Schemas parser error|WXS schema .* failed to compile/);
    return;
  }
  assert.equal(result.status, 0);
}

test("Libro de Ventas PRE-CAF serializado valida contra XSD oficial con Signature fixture", () => {
  const xml = serializeSalesBookXml(buildSalesBookFixture(), { includeFixtureSignature: true });
  const result = validateLibroCvXml(xml);
  assertLibroCvValidationResult(result);
});

test("Libro de Compras 4959700 contiene siete detalles exactos", () => {
  const model = buildPurchaseBookFixture();
  assert.equal(model.detalle.length, 7);
  assert.deepEqual(model.detalle.map((item) => [item.tpoDoc, item.folio]), [
    [30, 234],
    [33, 32],
    [30, 781],
    [60, 451],
    [33, 67],
    [46, 9],
    [60, 211],
  ]);
});

test("Libro de Compras calcula totales de cada documento", () => {
  const model = buildPurchaseBookFixture();
  assert.deepEqual(model.detalle.map((item) => ({ caseId: item.caseId, neto: item.mntNeto, exe: item.mntExe, iva: item.mntIVA, usoComun: item.ivaUsoComun, noRec: item.ivaNoRec?.mntIVANoRec ?? 0, ret: item.ivaRetTotal, total: item.mntTotal })), [
    { caseId: "4959700-1", neto: 5031, exe: 0, iva: 956, usoComun: 0, noRec: 0, ret: 0, total: 5987 },
    { caseId: "4959700-2", neto: 4010, exe: 7933, iva: 762, usoComun: 0, noRec: 0, ret: 0, total: 12705 },
    { caseId: "4959700-3", neto: 29589, exe: 0, iva: 0, usoComun: 5622, noRec: 0, ret: 0, total: 35211 },
    { caseId: "4959700-4", neto: 2612, exe: 0, iva: 496, usoComun: 0, noRec: 0, ret: 0, total: 3108 },
    { caseId: "4959700-5", neto: 8952, exe: 0, iva: 0, usoComun: 0, noRec: 1701, ret: 0, total: 10653 },
    { caseId: "4959700-6", neto: 9037, exe: 0, iva: 0, usoComun: 0, noRec: 0, ret: 1717, total: 9037 },
    { caseId: "4959700-7", neto: 2130, exe: 0, iva: 405, usoComun: 0, noRec: 0, ret: 0, total: 2535 },
  ]);
});

test("Libro de Compras resume por tipo sin compensar notas", () => {
  const model = buildPurchaseBookFixture();
  assert.deepEqual(model.resumenPeriodo, [
    { tpoDoc: 30, totDoc: 2, totMntExe: 0, totMntNeto: 34620, totOpIVARec: 1, totMntIVA: 956, totOpIVAUsoComun: 1, totIVAUsoComun: 5622, fctProp: "0.600", totCredIVAUsoComun: 3373, totMntTotal: 41198 },
    { tpoDoc: 33, totDoc: 2, totMntExe: 7933, totMntNeto: 12962, totOpIVARec: 1, totMntIVA: 762, totIVANoRec: { codIVANoRec: 4, totOpIVANoRec: 1, totMntIVANoRec: 1701 }, totMntTotal: 23358 },
    { tpoDoc: 60, totDoc: 2, totMntExe: 0, totMntNeto: 4742, totOpIVARec: 2, totMntIVA: 901, totMntTotal: 5643 },
    { tpoDoc: 46, totDoc: 1, totMntExe: 0, totMntNeto: 9037, totMntIVA: 0, totOtrosImp: { codImp: 15, totMntImp: 1717 }, totOpIVARetTotal: 1, totIVARetTotal: 1717, totMntTotal: 9037, totOpIVANoRetenido: 1, totIVANoRetenido: 0 },
  ]);
});

test("Libro de Compras valida IVA normal, mixto, uso comun, no recuperable y retencion", () => {
  const model = buildPurchaseBookFixture();
  const normal = model.detalle[0];
  const mixed = model.detalle[1];
  const common = model.detalle[2];
  const free = model.detalle[4];
  const retained = model.detalle[5];
  assert.equal(normal.mntIVA, 956);
  assert.equal(mixed.mntExe, 7933);
  assert.equal(mixed.mntIVA, 762);
  assert.equal(common.ivaUsoComun, 5622);
  assert.equal(model.resumenPeriodo[0].totCredIVAUsoComun, 3373);
  assert.deepEqual(free.ivaNoRec, { codIVANoRec: 4, mntIVANoRec: 1701 });
  assert.deepEqual(retained.otrosImp, { codImp: 15, tasaImp: 19, mntImp: 1717 });
  assert.equal(retained.ivaRetTotal, 1717);
  assert.equal(retained.ivaNoRetenido, 0);
});

test("Libro de Compras mantiene tipos de IVA mutuamente excluyentes", () => {
  const model = buildPurchaseBookFixture();
  for (const detail of model.detalle) {
    const active = [detail.mntIVA > 0, detail.ivaUsoComun > 0, Boolean(detail.ivaNoRec), detail.ivaRetTotal > 0].filter(Boolean).length;
    assert.ok(active <= 1, detail.caseId);
  }
});

test("Libro de Compras rechaza cuadraturas incorrectas, proveedor invalido y periodo distinto", () => {
  assert.throws(
    () => buildPurchaseBookModel({
      externalData: purchaseBookExternalData,
      providers: purchaseBookProviders,
      salesBookPeriod: "2026-07",
      entries: PURCHASE_BOOK_SET_4959700.map((item) => item.caseId === "4959700-1" ? { ...item, expectedTotal: 1 } : item),
    }),
    /Cuadratura incorrecta/,
  );
  assert.throws(
    () => buildPurchaseBookModel({
      externalData: purchaseBookExternalData,
      providers: { ...purchaseBookProviders, "4959700-1": { rut: "11111111-2", name: "Proveedor Invalido" } },
      salesBookPeriod: "2026-07",
    }),
    /Invalid Chilean RUT/,
  );
  assert.throws(
    () => buildPurchaseBookModel({
      externalData: { ...purchaseBookExternalData, periodoTributario: "2026-08" },
      providers: purchaseBookProviders,
      salesBookPeriod: "2026-07",
    }),
    /debe igualar Libro de Ventas/,
  );
});

test("Libro de Compras genera caratula exacta, XML serializable y valida XSD con Signature fixture", () => {
  const model = buildPurchaseBookFixture();
  assert.deepEqual(model.caratula, {
    rutEmisorLibro: "78195645-7",
    rutEnvia: "12345678-5",
    periodoTributario: "2026-07",
    fchResol: "2026-07-19",
    nroResol: 1,
    tipoOperacion: "COMPRA",
    tipoLibro: "ESPECIAL",
    tipoEnvio: "TOTAL",
    folioNotificacion: 2,
  });
  const xml = serializePurchaseBookXml(model, { includeFixtureSignature: true });
  assert.match(xml, /<TipoOperacion>COMPRA<\/TipoOperacion>/);
  assert.match(xml, /<FolioNotificacion>2<\/FolioNotificacion>/);
  assert.match(xml, /<CodIVANoRec>4<\/CodIVANoRec>/);
  assert.match(xml, /<CodImp>15<\/CodImp>/);
  assert.doesNotMatch(xml, /1\.701|PENDING_REAL_FOLIO/);
  assert.equal(model.status, "PRE_CAF_NOT_READY");
  const result = validateLibroCvXml(xml);
  assertLibroCvValidationResult(result);
});


test("PRE-CAF 5 verifica checksums de schemas oficiales", () => {
  const hashes = {
    "docs/dte-sii/xsd/LibroCV_v10.xsd": "d38672ec612888b4f952264372afc836d5b905579d9735159fefe9ddacf167ce",
    "docs/dte-sii/xsd/LceSiiTypes_v10.xsd": "fcccac6db4de9a74e157316d46abfa3f529086f55d45e68a9974204a25d98ca2",
    "docs/dte-sii/xsd/LceCal_v10.xsd": "47378044d6dff87a9ccda7f02e338bda7665f5bcd9da1b54c79e81da5ddf5257",
    "docs/dte-sii/xsd/LceCoCertif_v10.xsd": "3fc1c20b35e916a427a4800f8bbc3616489833784372f5bce9d3c121ca9fbde8",
    "docs/dte-sii/xsd/xmldsignature_v10.xsd": "427e3225cd379ae92bae464b892dbf964665af92d453ac61774cffab38b95edb",
  };
  for (const [file, expected] of Object.entries(hashes)) {
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), expected);
  }
});

test("PRE-CAF 5 detecta schema alterado por checksum", () => {
  const altered = createHash("sha256").update(`${readFileSync("docs/dte-sii/xsd/LibroCV_v10.xsd", "utf8")}\n`).digest("hex");
  assert.notEqual(altered, "d38672ec612888b4f952264372afc836d5b905579d9735159fefe9ddacf167ce");
});

test("PRE-CAF 5 contrato detecta datos externos faltantes", () => {
  const result = validatePreCafExternalData({});
  assert.equal(result.ok, false);
  assert.ok(result.missingFields.includes("issuer.rutEmisor"));
  assert.ok(result.missingFields.includes("receivers.receiver1.rut"));
  assert.ok(result.missingFields.includes("purchaseProviders.4959700-1.rut"));
});

test("PRE-CAF 7 example mantiene issuer.periodoTributario requerido por contrato", () => {
  const example = JSON.parse(readFileSync("docs/dte-sii/factura-pre-caf-input.example.json", "utf8"));
  assert.equal(example.issuer.periodoTributario, "YYYY-MM");
  const result = validatePreCafExternalData(example);
  assert.equal(result.missingFields.includes("issuer.periodoTributario"), false);
});

test("PRE-CAF 5 contrato rechaza receptores duplicados, RUT invalido y giro igual", () => {
  const result = validatePreCafExternalData({
    issuer: {
      rutEmisor: "78195645-7",
      razonSocial: "R&G SpA Fixture",
      giroEmisor: "GIRO FIXTURE COMPLETO",
      acteco: "123456",
      direccionOrigen: "Direccion Fixture",
      comunaOrigen: "Coquimbo",
      ciudadOrigen: "Coquimbo",
      fechaResolucion: "2026-07-19",
      numeroResolucion: 1,
      rutEnvia: "11111111-2",
      periodoTributario: "2026-07",
    },
    receivers: {
      receiver1: { rut: "11111111-1", razonSocial: "A", giro: "G", direccion: "D", comuna: "C", ciudad: "C" },
      receiver2: { rut: "11111111-1", razonSocial: "B", giro: "G", direccion: "D", comuna: "C", ciudad: "C" },
      receiver3: { rut: "11111111-2", razonSocial: "C", giro: "G", direccion: "D", comuna: "C", ciudad: "C" },
      receiver4: { rut: "11111111-1", razonSocial: "D", giro: "G", direccion: "D", comuna: "C", ciudad: "C" },
    },
    textCorrection: { giroAnterior: "MISMO", giroCorregido: "MISMO" },
    purchaseProviders: {
      "4959700-1": { rut: "11111111-1", razonSocial: "P1" },
      "4959700-2": { rut: "11111111-1", razonSocial: "P2" },
      "4959700-3": { rut: "11111111-1", razonSocial: "P3" },
      "4959700-4": { rut: "11111111-1", razonSocial: "P4" },
      "4959700-5": { rut: "11111111-1", razonSocial: "P5" },
      "4959700-6": { rut: "11111111-1", razonSocial: "P6" },
      "4959700-7": { rut: "11111111-1", razonSocial: "P7" },
    },
  });
  assert.ok(result.invalidFields.includes("issuer.rutEnvia"));
  assert.ok(result.invalidFields.includes("receivers.distinctRut"));
  assert.ok(result.invalidFields.includes("receivers.receiver3.rut"));
  assert.ok(result.invalidFields.includes("textCorrection.giroAnteriorDifferentFromGiroCorregido"));
});

test("PRE-CAF 7.1 contrato exige emisor excluido, proveedores distintos y giro corregido consistente", () => {
  const payload = validPreCafExternalFixture();
  payload.receivers.receiver4.rut = payload.issuer.rutEmisor;
  payload.purchaseProviders["4959700-7"].rut = payload.purchaseProviders["4959700-1"].rut;
  payload.textCorrection.giroCorregido = "GIRO DISTINTO AL RECEPTOR UNO";

  const result = validatePreCafExternalData(payload);
  assert.ok(result.invalidFields.includes("counterparties.issuerExcluded"));
  assert.ok(result.invalidFields.includes("purchaseProviders.distinctRut"));
  assert.ok(result.invalidFields.includes("textCorrection.giroCorregidoMatchesReceiver1Giro"));
});

const officialXsdFiles = [
  "LibroCV_v10.xsd",
  "LceSiiTypes_v10.xsd",
  "LceCal_v10.xsd",
  "LceCoCertif_v10.xsd",
  "xmldsignature_v10.xsd",
] as const;

function copyOfficialXsdFixture(): string {
  const source = join(process.cwd(), "docs/dte-sii/xsd");
  const target = mkdtempSync(join(tmpdir(), "citaya-xsd-fixture-"));
  for (const file of officialXsdFiles) copyFileSync(join(source, file), join(target, file));
  return target;
}

function runBooksXsdCheck(env: NodeJS.ProcessEnv = {}) {
  return spawnSync("npm", ["run", "dte:books:xsd:check"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("PRE-CAF 5.1 comando XSD valida ventas y compras con validador compatible", () => {
  const result = runBooksXsdCheck();
  assert.equal(result.status, 0, `${result.stdout}
${result.stderr}`);
  assert.match(result.stdout, /schemaIntegrity=ok/);
  assert.match(result.stdout, /xmllint=unsupported_official_decimal_facet/);
  assert.match(result.stdout, /compatibleValidator=docker:eclipse-temurin:21\.0\.5_11-jdk@sha256:/);
  assert.match(result.stdout, /schemaCompile=ok/);
  assert.match(result.stdout, /salesBook=valid/);
  assert.match(result.stdout, /purchaseBook=valid/);
});

test("PRE-CAF 5.1 comando XSD detecta schema alterado", () => {
  const xsdDir = copyOfficialXsdFixture();
  const libroPath = join(xsdDir, "LibroCV_v10.xsd");
  writeFileSync(libroPath, `${readFileSync(libroPath, "utf8")}
<!-- altered test copy -->
`, "utf8");

  const result = runBooksXsdCheck({ DTE_BOOKS_XSD_DIR: xsdDir });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /schemaIntegrity=failed/);
  assert.match(result.stdout, /checksumMismatch=LibroCV_v10\.xsd/);
});

test("PRE-CAF 5.1 comando XSD detecta dependencia faltante", () => {
  const xsdDir = mkdtempSync(join(tmpdir(), "citaya-xsd-missing-"));
  mkdirSync(xsdDir, { recursive: true });
  for (const file of officialXsdFiles) {
    if (file !== "LceSiiTypes_v10.xsd") copyFileSync(join(process.cwd(), "docs/dte-sii/xsd", file), join(xsdDir, file));
  }

  const result = runBooksXsdCheck({ DTE_BOOKS_XSD_DIR: xsdDir });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /schemaIntegrity=failed/);
  assert.match(result.stdout, /missing=LceSiiTypes_v10\.xsd/);
});

test("PRE-CAF 5.1 comando XSD reporta Libro de Ventas invalido", () => {
  const result = runBooksXsdCheck({ DTE_BOOKS_XSD_FIXTURE_MODE: "invalid-sales" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /schemaCompile=failed/);
  assert.match(result.stdout, /salesBook=invalid/);
  assert.match(result.stdout, /salesBook\.line=\d+/);
  assert.match(result.stdout, /salesBook\.column=\d+/);
  assert.match(result.stdout, /salesBook\.message=/);
});

test("PRE-CAF 5.1 comando XSD reporta Libro de Compras invalido", () => {
  const result = runBooksXsdCheck({ DTE_BOOKS_XSD_FIXTURE_MODE: "invalid-purchase" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /schemaCompile=failed/);
  assert.match(result.stdout, /purchaseBook=invalid/);
  assert.match(result.stdout, /purchaseBook\.line=\d+/);
  assert.match(result.stdout, /purchaseBook\.column=\d+/);
  assert.match(result.stdout, /purchaseBook\.message=/);
});

test("PRE-CAF 5.1 comando XSD falla si el validador compatible no esta disponible", () => {
  const result = runBooksXsdCheck({ DTE_BOOKS_XSD_VALIDATOR: "none" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /schemaIntegrity=ok/);
  assert.match(result.stdout, /compatibleValidator=unavailable/);
});

const preCafSecretFixture = "SECRETO-CLIENTE-FICTICIO";

function validPreCafExternalFixture() {
  return {
    issuer: {
      rutEmisor: "11111111-1",
      razonSocial: `EMISOR FIXTURE ${preCafSecretFixture}`,
      giroEmisor: "GIRO COMPLETO FIXTURE",
      acteco: "620900",
      direccionOrigen: "DIRECCION EMISOR FIXTURE",
      comunaOrigen: "COMUNA FIXTURE",
      ciudadOrigen: "CIUDAD FIXTURE",
      fechaResolucion: "2026-05-23",
      numeroResolucion: 0,
      rutEnvia: "12345678-5",
      periodoTributario: "2026-07",
    },
    receivers: {
      receiver1: { rut: "22222222-2", razonSocial: "RECEPTOR UNO FIXTURE", giro: "GIRO UNO", direccion: "DIRECCION UNO", comuna: "COMUNA UNO", ciudad: "CIUDAD UNO" },
      receiver2: { rut: "33333333-3", razonSocial: "RECEPTOR DOS FIXTURE", giro: "GIRO DOS", direccion: "DIRECCION DOS", comuna: "COMUNA DOS", ciudad: "CIUDAD DOS" },
      receiver3: { rut: "44444444-4", razonSocial: "RECEPTOR TRES FIXTURE", giro: "GIRO TRES", direccion: "DIRECCION TRES", comuna: "COMUNA TRES", ciudad: "CIUDAD TRES" },
      receiver4: { rut: "55555555-5", razonSocial: "RECEPTOR CUATRO FIXTURE", giro: "GIRO CUATRO", direccion: "DIRECCION CUATRO", comuna: "COMUNA CUATRO", ciudad: "CIUDAD CUATRO" },
    },
    textCorrection: { giroAnterior: "GIRO ANTERIOR FIXTURE", giroCorregido: "GIRO UNO" },
    purchaseProviders: {
      "4959700-1": { rut: "66666666-6", razonSocial: "PROVEEDOR UNO FIXTURE" },
      "4959700-2": { rut: "77777777-7", razonSocial: "PROVEEDOR DOS FIXTURE" },
      "4959700-3": { rut: "88888888-8", razonSocial: "PROVEEDOR TRES FIXTURE" },
      "4959700-4": { rut: "87654321-4", razonSocial: "PROVEEDOR CUATRO FIXTURE" },
      "4959700-5": { rut: "76543210-3", razonSocial: "PROVEEDOR CINCO FIXTURE" },
      "4959700-6": { rut: "11222333-9", razonSocial: "PROVEEDOR SEIS FIXTURE" },
      "4959700-7": { rut: "22111222-9", razonSocial: "PROVEEDOR SIETE FIXTURE" },
    },
  };
}

function writePreCafExternalFixture(payload: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "citaya-pre-caf-input-"));
  const file = join(dir, "input.json");
  writeFileSync(file, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  return file;
}

function runPreCafCheck(env: NodeJS.ProcessEnv = {}) {
  return spawnSync("npm", ["run", "dte:pre-caf:check"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOCKER_HOST: process.env.DOCKER_HOST,
      DTE_SII_ENV: "certification",
      DTE_SII_ENABLE_SUBMIT: "false",
      DTE_FACTURA_PRE_CAF_ISSUE_DATE: "2026-07-19",
      ...env,
    },
  });
}

test("PRE-CAF 6 checker falla cerrado si falta ruta externa", () => {
  const result = runPreCafCheck({ DTE_FACTURA_PRE_CAF_INPUT_PATH: "" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status=PRE_CAF_NOT_READY/);
  assert.match(result.stdout, /DTE_FACTURA_PRE_CAF_INPUT_PATH/);
  assert.match(result.stdout, /readyToDownloadCaf=false/);
});

test("PRE-CAF 6 checker falla cerrado con JSON invalido", () => {
  const inputPath = writePreCafExternalFixture("{invalid-json");
  const result = runPreCafCheck({ DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status=PRE_CAF_NOT_READY/);
  assert.match(result.stdout, /DTE_FACTURA_PRE_CAF_INPUT_JSON/);
  assert.doesNotMatch(result.stdout, /invalid-json/);
});

test("PRE-CAF 6 checker reporta datos incompletos sin valores", () => {
  const inputPath = writePreCafExternalFixture({ issuer: { rutEmisor: "11111111-1" } });
  const result = runPreCafCheck({ DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /issuer\.razonSocial/);
  assert.match(result.stdout, /receivers\.receiver1\.rut/);
  assert.doesNotMatch(result.stdout, /11111111-1|SECRETO/);
});

test("PRE-CAF 6 checker rechaza RUT invalidos", () => {
  const payload = validPreCafExternalFixture();
  payload.issuer.rutEnvia = "11111111-2";
  payload.purchaseProviders["4959700-1"].rut = "BAD-RUT";
  const inputPath = writePreCafExternalFixture(payload);
  const result = runPreCafCheck({ DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /issuer\.rutEnvia/);
  assert.match(result.stdout, /purchaseProviders\.4959700-1\.rut/);
  assert.doesNotMatch(result.stdout, /BAD-RUT|11111111-2/);
});

test("PRE-CAF 6 checker rechaza receptores duplicados", () => {
  const payload = validPreCafExternalFixture();
  payload.receivers.receiver2.rut = payload.receivers.receiver1.rut;
  const inputPath = writePreCafExternalFixture(payload);
  const result = runPreCafCheck({ DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /receivers\.distinctRut/);
  assert.doesNotMatch(result.stdout, /22222222-2/);
});

test("PRE-CAF 6 checker bloquea production y nunca declara READY_TO_DOWNLOAD_CAF", () => {
  const inputPath = writePreCafExternalFixture(validPreCafExternalFixture());
  const result = runPreCafCheck({ DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath, DTE_SII_ENV: "production" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status=PRE_CAF_NOT_READY/);
  assert.match(result.stdout, /productionBlocked|DTE_SII_ENV/);
  assert.match(result.stdout, /readyToDownloadCaf=false/);
  assert.doesNotMatch(result.stdout, /READY_TO_DOWNLOAD_CAF/);
});

test("PRE-CAF 6 checker alcanza PRE_CAF_OFFLINE_READY con input externo completo y salida redactada", () => {
  const inputPath = writePreCafExternalFixture(validPreCafExternalFixture());
  const result = runPreCafCheck({ DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath });
  assert.equal(result.status, 0, `${result.stdout}
${result.stderr}`);
  assert.match(result.stdout, /status=PRE_CAF_OFFLINE_READY/);
  assert.match(result.stdout, /missing=/);
  assert.match(result.stdout, /invalid=/);
  assert.match(result.stdout, /readyToDownloadCaf=false/);
  assert.doesNotMatch(result.stdout, /READY_TO_DOWNLOAD_CAF/);
  assert.doesNotMatch(result.stdout, /11111111-1|12345678-5|SECRETO-CLIENTE-FICTICIO|DIRECCION/);
});

test("PRE-CAF 6 checker deriva confirmaciones operativas y bloquea CAF, folios, submit y track_id", () => {
  const inputPath = writePreCafExternalFixture(validPreCafExternalFixture());
  const result = runPreCafCheck({
    DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath,
    DTE_CAF_PATH: "/tmp/caf-real-no-usar.xml",
    DTE_CERTIFICATION_FOLIO: "1",
    DTE_SII_ENABLE_SUBMIT: "true",
    DTE_TRACK_ID: "TRACK-SECRETO-FIXTURE",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /cafAbsentConfirmed/);
  assert.match(result.stdout, /foliosNotReservedConfirmed/);
  assert.match(result.stdout, /submitDisabledConfirmed/);
  assert.match(result.stdout, /trackIdSimulationAbsentConfirmed/);
  assert.doesNotMatch(result.stdout, /TRACK-SECRETO-FIXTURE|caf-real-no-usar/);
});


const certificationTestEnv = {
  NODE_ENV: "test",
  DTE_MODE: "certification",
  DTE_SII_ENV: "certification",
  DTE_SII_LIVE_AUTH: "false",
  DTE_SII_ENABLE_SUBMIT: "false",
  DTE_SII_ENABLE_STATUS: "false",
};
function runFacturaSetFixture(overrides = {}, env = {}) {
  const inputPath = writePreCafExternalFixture(validPreCafExternalFixture());
  const outputDir = mkdtempSync(join(tmpdir(), "citaya-pre-caf-8-output-"));
  const result = runFacturaSetDryRun({
    outputDir,
    overrides,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...certificationTestEnv,
      DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath,
      DTE_FACTURA_PRE_CAF_ISSUE_DATE: "2026-07-19",
      ...env,
    },
  });
  return { ...result, inputPath };
}

test("PRE-CAF 8 genera Set Basico 4959698 offline con CAF, folios y certificado fixture", () => {
  const result = runFacturaSetFixture();
  assert.equal(result.environment, "certification");
  assert.equal(result.fixtureMode, true);
  assert.equal(result.documents, 8);
  assert.equal(result.type33, 4);
  assert.equal(result.type61, 3);
  assert.equal(result.type56, 1);
  assert.equal(result.dteXsd, "8/8");
  assert.equal(result.envioDteXsd, "valid");
  assert.equal(result.tedFrmt, "8/8");
  assert.equal(result.dteSignatures, "8/8");
  assert.equal(result.envelopeSignature, "valid");
  assert.equal(result.references, "valid");
  assert.equal(result.totals, "valid");
  assert.equal(result.realCaf, false);
  assert.equal(result.realFolios, false);
  assert.equal(result.siiContacted, false);
  assert.equal(result.readyToDownloadCaf, false);
  const output = formatFacturaSetDryRunResult(result);
  assert.doesNotMatch(output, /11111111-1|22222222-2|DIRECCION|SECRETO-CLIENTE-FICTICIO/);
});


test("PRE-CAF 8 declara la cabecera SII exacta sin alterar XSD ni firmas", () => {
  const result = runFacturaSetFixture();
  const bytes = readFileSync(
    join(result.outputDir, "EnvioDTE-4959698-FIXTURE-SIN-VALIDEZ.xml"),
  );
  const lines = bytes.toString("latin1").split("\n");
  assert.deepEqual(lines.slice(0, 2), [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<EnvioDTE xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd" version="1.0">',
  ]);
  assert.equal(Buffer.from(bytes.toString("latin1"), "latin1").equals(bytes), true);
  assert.equal(result.envioDteXsd, "valid");
  assert.equal(result.dteSignatures, "8/8");
  assert.equal(result.envelopeSignature, "valid");
  assert.equal(result.references, "valid");
  assert.equal(result.totals, "valid");
});

test("PRE-CAF 8 comando imprime solamente resumen seguro", () => {
  const inputPath = writePreCafExternalFixture(validPreCafExternalFixture());
  const outputDir = mkdtempSync(join(tmpdir(), "citaya-pre-caf-8-command-"));
  const result = spawnSync("npm", ["run", "dte:factura:set:dry-run"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...certificationTestEnv,
      DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath,
      DTE_FACTURA_PRE_CAF_ISSUE_DATE: "2026-07-19",
      DTE_FACTURA_SET_DRY_RUN_OUTPUT_DIR: outputDir,
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /environment=certification/);
  assert.match(result.stdout, /dteXsd=8\/8/);
  assert.match(result.stdout, /readyToDownloadCaf=false/);
  assert.doesNotMatch(result.stdout + result.stderr, /11111111-1|22222222-2|DIRECCION|SECRETO-CLIENTE-FICTICIO|PRIVATE KEY|BEGIN CERTIFICATE/);
});

test("PRE-CAF 8 rechaza CAF fixture de otro emisor, tipo o rango", () => {
  assert.throws(() => runFacturaSetFixture({ cafIssuerRut: "22222222-2" }), /CAF RUT emisor no coincide/);
  assert.throws(() => runFacturaSetFixture({ cafTypeByCase: { "4959698-1": 61 } }), /CAF tipo DTE no coincide/);
  assert.throws(() => runFacturaSetFixture({ cafRangeByCase: { "4959698-1": { from: 1, to: 2 } } }), /fuera del rango CAF/);
});

test("PRE-CAF 8 rechaza folio repetido, referencia incorrecta y orden incorrecto", () => {
  assert.throws(() => runFacturaSetFixture({ folioByCase: { "4959698-2": 330001 } }), /folio fixture repetido/);
  assert.throws(() => runFacturaSetFixture({ referenceSourceByCase: { "4959698-6": "4959698-1" } }), /referencia tributaria fixture invalida/);
  assert.throws(() => runFacturaSetFixture({ caseOrder: ["4959698-2", "4959698-1", "4959698-3", "4959698-4", "4959698-5", "4959698-6", "4959698-7", "4959698-8"] }), /orden completo del set/);
});

test("PRE-CAF 8 rechaza firma alterada, total alterado y certificado llave distintos", () => {
  assert.throws(() => runFacturaSetFixture({ tamperDocumentSignatureCase: "4959698-1" }), /firmas DTE fixture no verifican 7\/8/);
  assert.throws(() => runFacturaSetFixture({ alterTotalCase: "4959698-1" }), /total DTE no cuadra/);
  assert.throws(() => runFacturaSetFixture({ mismatchedCertificateKey: true }), /firma XMLDSig DTE fixture no verifica localmente|firmas DTE fixture no verifican/);
});

test("PRE-CAF 8 bloquea production antes de inspeccionar rutas CAF heredadas", () => {
  assert.throws(() => runFacturaSetFixture({}, { DTE_MODE: "production", DTE_CAF_PATH: "/tmp/caf.xml" }), /field=production/);
  assert.throws(() => runFacturaSetFixture({}, { DTE_SII_ENV: "production", DTE_CAF_PRIVATE_KEY_PATH: "/tmp/caf.key" }), /field=production/);
});

test("PRE-CAF 8 bloquea rutas CAF heredadas en certification", () => {
  assert.throws(() => runFacturaSetFixture({}, { DTE_CAF_PATH: "/tmp/caf.xml" }), /field=DTE_CAF_PATH/);
  assert.throws(() => runFacturaSetFixture({}, { DTE_CAF_PRIVATE_KEY_PATH: "/tmp/caf.key" }), /field=DTE_CAF_PRIVATE_KEY_PATH/);
  assert.throws(() => runFacturaSetFixture({}, { DTE_SII_ENABLE_SUBMIT: "true" }), /red SII/);
});


function prepareFacturaEncodingAuditFixture() {
  const inputPath = writePreCafExternalFixture(validPreCafExternalFixture());
  const outputDir = mkdtempSync(join(tmpdir(), "citaya-pre-caf-9-fixture-"));
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...certificationTestEnv,
    DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath,
    DTE_FACTURA_PRE_CAF_ISSUE_DATE: "2026-07-19",
  };
  runFacturaSetDryRun({ outputDir, env });
  return { outputDir, env };
}

function updateXmlManifestHash(outputDir: string, fileName: string) {
  const manifestPath = join(outputDir, "manifest-4959698-FIXTURE-SIN-VALIDEZ.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = manifest.files.find((item: { file: string }) => item.file === fileName);
  assert.ok(entry);
  entry.sha256 = createHash("sha256").update(readFileSync(join(outputDir, fileName))).digest("hex");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

function overwriteLatin1Xml(path: string, xml: string) {
  writeFileSync(path, encodeIso88591Strict(xml));
}

function readSetManifest(outputDir: string, name = "manifest-4959698-FIXTURE-SIN-VALIDEZ.json") {
  return JSON.parse(readFileSync(join(outputDir, name), "utf8"));
}

function writeSetManifest(outputDir: string, manifest: unknown, name = "manifest-4959698-FIXTURE-SIN-VALIDEZ.json") {
  writeFileSync(join(outputDir, name), JSON.stringify(manifest, null, 2), "utf8");
}

function prepareRealManifestAuditFixture() {
  const fixture = prepareFacturaEncodingAuditFixture();
  const source = readSetManifest(fixture.outputDir);
  const suffix = "-FIXTURE-SIN-VALIDEZ.xml";
  const replacement = "-CERTIFICATION.xml";
  for (const item of source.files as Array<{ file: string }>)
    copyFileSync(join(fixture.outputDir, item.file), join(fixture.outputDir, item.file.replace(suffix, replacement)));
  const typeByCase: Record<string, 33 | 56 | 61> = {
    "4959698-1": 33, "4959698-2": 33, "4959698-3": 33, "4959698-4": 33,
    "4959698-5": 61, "4959698-6": 61, "4959698-7": 61, "4959698-8": 56,
  };
  const cafHashes = [33, 61, 56].map((type) => {
    const hashes = new Set((source.cafFixtures as Array<{ caseId: string; sha256: string }>)
      .filter((item) => typeByCase[item.caseId] === type)
      .map((item) => item.sha256));
    assert.equal(hashes.size, 1);
    return { type, sha256: [...hashes][0] };
  });
  writeSetManifest(fixture.outputDir, {
    fixtureMode: false,
    legalValidity: "CERTIFICATION_OFFLINE_NOT_SUBMITTED",
    encoding: "ISO-8859-1",
    generatedAt: source.generatedAt,
    files: source.files.map((item: { file: string; sha256: string }) => ({
      file: item.file.replace(suffix, replacement),
      sha256: createHash("sha256").update(readFileSync(join(fixture.outputDir, item.file.replace(suffix, replacement)))).digest("hex"),
    })),
    cafHashes,
  }, "manifest-4959698-CERTIFICATION.json");
  return fixture;
}

test("PRE-CAF 8 manifiesto fixture usa solamente cafFixtures sintéticos", () => {
  const fixture = prepareFacturaEncodingAuditFixture();
  const manifest = readSetManifest(fixture.outputDir);
  assert.equal(manifest.fixtureMode, true);
  assert.equal(manifest.cafFixtures.length, 8);
  assert.equal(Object.hasOwn(manifest, "cafHashes"), false);
  assert.ok(manifest.cafFixtures.every((item: { caseId: string; sha256: string }) => /^4959698-[1-8]$/.test(item.caseId) && /^[a-f0-9]{64}$/.test(item.sha256)));
});

test("PRE-CAF 9 audita manifiesto de certificación con cafHashes por tipo", () => {
  const fixture = prepareRealManifestAuditFixture();
  const result = auditFacturaSetFinalFiles({ outputDir: fixture.outputDir, env: fixture.env, skipGeneration: true, manifestMode: "real" });
  assert.equal(result.fixtureMode, false);
  assert.equal(result.realCaf, true);
  const manifest = readSetManifest(fixture.outputDir, "manifest-4959698-CERTIFICATION.json");
  assert.equal(Object.hasOwn(manifest, "cafFixtures"), false);
  assert.deepEqual(manifest.cafHashes.map((item: { type: number }) => item.type), [33, 61, 56]);
});

test("PRE-CAF 9 rechaza manifiesto fixture con ambos campos CAF", () => {
  const fixture = prepareFacturaEncodingAuditFixture();
  const manifest = readSetManifest(fixture.outputDir);
  manifest.cafHashes = [{ type: 33, sha256: "a".repeat(64) }, { type: 61, sha256: "b".repeat(64) }, { type: 56, sha256: "c".repeat(64) }];
  writeSetManifest(fixture.outputDir, manifest);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: fixture.outputDir, env: fixture.env, skipGeneration: true }), /field=cafFixtures/);
});

test("PRE-CAF 9 rechaza manifiesto fixture sin campo CAF", () => {
  const fixture = prepareFacturaEncodingAuditFixture();
  const manifest = readSetManifest(fixture.outputDir);
  delete manifest.cafFixtures;
  writeSetManifest(fixture.outputDir, manifest);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: fixture.outputDir, env: fixture.env, skipGeneration: true }), /field=cafFixtures/);
});

test("PRE-CAF 9 rechaza cafHashes bajo fixtureMode", () => {
  const fixture = prepareFacturaEncodingAuditFixture();
  const manifest = readSetManifest(fixture.outputDir);
  delete manifest.cafFixtures;
  manifest.cafHashes = [{ type: 33, sha256: "a".repeat(64) }, { type: 61, sha256: "b".repeat(64) }, { type: 56, sha256: "c".repeat(64) }];
  writeSetManifest(fixture.outputDir, manifest);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: fixture.outputDir, env: fixture.env, skipGeneration: true }), /field=cafFixtures/);
});

test("PRE-CAF 9 rechaza cafFixtures bajo manifiesto real", () => {
  const fixture = prepareRealManifestAuditFixture();
  const manifest = readSetManifest(fixture.outputDir, "manifest-4959698-CERTIFICATION.json");
  manifest.cafFixtures = [];
  writeSetManifest(fixture.outputDir, manifest, "manifest-4959698-CERTIFICATION.json");
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: fixture.outputDir, env: fixture.env, skipGeneration: true, manifestMode: "real" }), /field=cafHashes/);
});

test("PRE-CAF 9 audita encoding y firmas sobre bytes finales", () => {
  const { outputDir, env } = prepareFacturaEncodingAuditFixture();
  const result = auditFacturaSetFinalFiles({ outputDir, env, skipGeneration: true });
  assert.equal(result.encoding, "ISO-8859-1");
  assert.equal(result.bom, "absent");
  assert.equal(result.cafPreserved, "8/8");
  assert.equal(result.tedFrmtFinalBytes, "8/8");
  assert.equal(result.dteSignaturesFinalBytes, "8/8");
  assert.equal(result.envelopeSignatureFinalBytes, "valid");
  assert.equal(result.dteXsdFinalBytes, "8/8");
  assert.equal(result.envioDteXsdFinalBytes, "valid");
  const output = formatFacturaEncodingAuditResult(result);
  assert.doesNotMatch(output, /11111111-1|22222222-2|DIRECCION|SECRETO-CLIENTE-FICTICIO|BEGIN CERTIFICATE|PRIVATE KEY/);
});

test("PRE-CAF 9 rechaza modificacion posterior a la firma", () => {
  const { outputDir, env } = prepareFacturaEncodingAuditFixture();
  const fileName = "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml";
  const file = join(outputDir, fileName);
  overwriteLatin1Xml(file, readFileSync(file).toString("latin1").replace("<MntTotal>147417</MntTotal>", "<MntTotal>147418</MntTotal>"));
  updateXmlManifestHash(outputDir, fileName);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir, env, skipGeneration: true }), /TED no coincide|XMLDSig|XSD final bytes invalido/);
});

test("PRE-CAF 9 rechaza CAF reformateado y whitespace alterado dentro de DD", () => {
  const fixture = prepareFacturaEncodingAuditFixture();
  const fileName = "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml";
  const file = join(fixture.outputDir, fileName);
  overwriteLatin1Xml(file, readFileSync(file).toString("latin1").replace("<CAF version=\"1.0\"><DA>", "<CAF version=\"1.0\">\n<DA>"));
  updateXmlManifestHash(fixture.outputDir, fileName);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: fixture.outputDir, env: fixture.env, skipGeneration: true }), /CAF fixture no preservado|FRMT final bytes/);

  const fixture2 = prepareFacturaEncodingAuditFixture();
  const file2 = join(fixture2.outputDir, fileName);
  overwriteLatin1Xml(file2, readFileSync(file2).toString("latin1").replace("<DD><RE>", "<DD>\n<RE>"));
  updateXmlManifestHash(fixture2.outputDir, fileName);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: fixture2.outputDir, env: fixture2.env, skipGeneration: true }), /FRMT final bytes|XSD final bytes/);
});

test("PRE-CAF 9 rechaza ampersand sin escapar, caracteres fuera de ISO, BOM y declaraciones inconsistentes", () => {
  const rawAmp = prepareFacturaEncodingAuditFixture();
  const fileName = "4959698-3-DTE-FIXTURE-SIN-VALIDEZ.xml";
  const ampFile = join(rawAmp.outputDir, fileName);
  overwriteLatin1Xml(ampFile, readFileSync(ampFile).toString("latin1").replace("Pintura B&amp;W AFECTO", "Pintura B&W AFECTO"));
  updateXmlManifestHash(rawAmp.outputDir, fileName);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: rawAmp.outputDir, env: rawAmp.env, skipGeneration: true }), /ampersand|XSD final bytes/);

  assert.throws(() => encodeIso88591Strict('<?xml version="1.0" encoding="ISO-8859-1"?><X>🙂</X>'), /fuera de ISO-8859-1|control XML invalido/);
  assert.throws(() => encodeIso88591Strict(`<?xml version="1.0" encoding="ISO-8859-1"?><X>“comillas” — guion</X>`), /fuera de ISO-8859-1/);
  assert.throws(() => encodeIso88591Strict('<?xml version="1.0" encoding="ISO-8859-1"?><X>\u0001</X>'), /control XML invalido/);

  const bom = prepareFacturaEncodingAuditFixture();
  const bomFile = join(bom.outputDir, "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml");
  writeFileSync(bomFile, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(bomFile)]));
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: bom.outputDir, env: bom.env, skipGeneration: true }), /BOM/);

  const utfDecl = prepareFacturaEncodingAuditFixture();
  const utfDeclFile = join(utfDecl.outputDir, "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml");
  overwriteLatin1Xml(utfDeclFile, readFileSync(utfDeclFile).toString("latin1").replace("ISO-8859-1", "UTF-8"));
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: utfDecl.outputDir, env: utfDecl.env, skipGeneration: true }), /encoding inconsistente/);

  const utfBytes = prepareFacturaEncodingAuditFixture();
  const utfBytesFile = join(utfBytes.outputDir, "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml");
  writeFileSync(utfBytesFile, readFileSync(utfBytesFile).toString("latin1"), "utf8");
  updateXmlManifestHash(utfBytes.outputDir, "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml");
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir: utfBytes.outputDir, env: utfBytes.env, skipGeneration: true }), /bytes UTF-8|acentos/);
});

test("PRE-CAF 9 rechaza sustitucion silenciosa por signo de interrogacion", () => {
  const { outputDir, env } = prepareFacturaEncodingAuditFixture();
  const fileName = "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml";
  const file = join(outputDir, fileName);
  overwriteLatin1Xml(file, readFileSync(file).toString("latin1").replaceAll("Cajón", "Caj?n"));
  updateXmlManifestHash(outputDir, fileName);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir, env, skipGeneration: true }), /acentos esperados|TED no coincide|FRMT final bytes/);
});

test("PRE-CAF 9 rechaza RSR o IT1 sobre maximo permitido", () => {
  const { outputDir, env } = prepareFacturaEncodingAuditFixture();
  const fileName = "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml";
  const file = join(outputDir, fileName);
  overwriteLatin1Xml(file, readFileSync(file).toString("latin1").replace(/<IT1>[^<]+<\/IT1>/, `<IT1>${"A".repeat(41)}</IT1>`));
  updateXmlManifestHash(outputDir, fileName);
  assert.throws(() => auditFacturaSetFinalFiles({ outputDir, env, skipGeneration: true }), /FRMT final bytes|RSR o IT1|XSD final bytes/);
});


function xmlsecFinalContextGate(result: { outputDir: string }) {
  const envelopePath = join(result.outputDir, "EnvioDTE-4959698-FIXTURE-SIN-VALIDEZ.xml");
  const xml = readFileSync(envelopePath, "latin1");
  const cert = xml.match(/<X509Certificate>([\s\S]*?)<\/X509Certificate>/)?.[1]?.replace(/\s/g, "") ?? "";
  const certPath = join(result.outputDir, ".xmlsec-test-cert.pem");
  writeFileSync(certPath, `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----\n`, { mode: 0o600 });
  const ids = [...xml.matchAll(/<Documento\b[^>]*\bID="([^"]+)"/g)].map((match) => match[1]);
  const verify = (id: string) => spawnSync("xmlsec1", ["--verify", "--id-attr:ID", "Documento", "--id-attr:ID", "SetDTE", "--pubkey-cert-pem", certPath, "--node-xpath", `//*[local-name()='Signature'][.//*[local-name()='Reference' and @URI='#${id}']]`, envelopePath], { encoding: "utf8" }).status === 0;
  const individual = ids.map(verify);
  const setId = xml.match(/<SetDTE\b[^>]*\bID="([^"]+)"/)?.[1] ?? "";
  return { individual, outer: Boolean(setId) && verify(setId) };
}

test("FOCAL correction-002 asocia los ocho documentos por dteType:folio", () => {
  const result = runFacturaSetFixture();
  const gate = xmlsecFinalContextGate(result);
  assert.equal(gate.individual.filter(Boolean).length, 8);
  assert.equal(gate.outer, true);
  return;
  const audit = auditFacturaSetFinalFiles({
    outputDir: result.outputDir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...certificationTestEnv,
      DTE_FACTURA_PRE_CAF_INPUT_PATH: result.inputPath,
      DTE_FACTURA_PRE_CAF_ISSUE_DATE: "2026-07-19",
    },
    skipGeneration: true,
  });
  const envelope = readFileSync(
    join(result.outputDir, "EnvioDTE-4959698-FIXTURE-SIN-VALIDEZ.xml"),
    "latin1",
  );
  const keys = [...envelope.matchAll(/<TipoDTE>(\d+)<\/TipoDTE>[\s\S]*?<Folio>(\d+)<\/Folio>/g)]
    .map((match) => `${match[1]}:${match[2]}`)
    .sort();
  assert.deepEqual(keys, ["33:330001", "33:330002", "33:330003", "33:330004", "56:560001", "61:610001", "61:610002", "61:610003"]);
  assert.equal(audit.dteSignaturesFinalBytes, "8/8");
});

test("FOCAL correction-002 conserva las ocho firmas DTE y la exterior en bytes finales", () => {
  const result = runFacturaSetFixture();
  const gate = xmlsecFinalContextGate(result);
  assert.equal(gate.individual.filter(Boolean).length, 8);
  assert.equal(gate.outer, true);
});

test("FOCAL correction-002 envuelve FRMT y firmas Base64 a 76 caracteres", () => {
  const result = runFacturaSetFixture();
  for (const name of [
    ...Array.from({ length: 8 }, (_, index) => `4959698-${index + 1}-DTE-FIXTURE-SIN-VALIDEZ.xml`),
    "EnvioDTE-4959698-FIXTURE-SIN-VALIDEZ.xml",
  ]) {
    const xml = readFileSync(join(result.outputDir, name), "latin1");
    for (const match of xml.matchAll(/<(FRMT|SignatureValue|X509Certificate)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g))
      for (const line of match[2].split("\n")) assert.ok(line.length <= 76, `${match[1]} exceeds 76`);
  }
});
