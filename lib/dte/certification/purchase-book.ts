import { normalizeRut } from "../rut";
import { escapeXml } from "../xml/escape-xml";
import { SALES_BOOK_SCHEMA_STATUS } from "./sales-book";

export type PurchaseBookExternalData = {
  rutEmisorLibro: string;
  rutEnvia: string;
  fchResol: string;
  nroResol: number;
  periodoTributario: string;
};

export type PurchaseBookProviderFixture = {
  rut: string;
  name: string;
};

export type PurchaseVatKind = "recoverable" | "common_use" | "non_recoverable" | "withholding" | "none";

export type PurchaseBookSourceEntry = {
  caseId: "4959700-1" | "4959700-2" | "4959700-3" | "4959700-4" | "4959700-5" | "4959700-6" | "4959700-7";
  tpoDoc: 30 | 33 | 46 | 60;
  folio: number;
  observation: string;
  mntNeto: number;
  mntExe: number;
  vatKind: PurchaseVatKind;
  commonVatFactor?: 0.6;
  codIVANoRec?: 4;
  codImp?: 15;
  expectedTotal: number;
};

export type PurchaseBookDetail = {
  caseId: PurchaseBookSourceEntry["caseId"];
  tpoDoc: 30 | 33 | 46 | 60;
  folio: number;
  fchDoc: string;
  providerRut: string;
  providerName: string;
  observation: string;
  mntExe: number;
  mntNeto: number;
  mntIVA: number;
  ivaUsoComun: number;
  ivaNoRec?: { codIVANoRec: 4; mntIVANoRec: number };
  otrosImp?: { codImp: 15; tasaImp: 19; mntImp: number };
  ivaRetTotal: number;
  ivaNoRetenido: number;
  mntTotal: number;
};

export type PurchaseBookTotals = {
  tpoDoc: 30 | 33 | 46 | 60;
  totDoc: number;
  totMntExe: number;
  totMntNeto: number;
  totOpIVARec?: number;
  totMntIVA: number;
  totIVANoRec?: { codIVANoRec: 4; totOpIVANoRec: number; totMntIVANoRec: number };
  totOpIVAUsoComun?: number;
  totIVAUsoComun?: number;
  fctProp?: "0.600";
  totCredIVAUsoComun?: number;
  totOtrosImp?: { codImp: 15; totMntImp: number };
  totOpIVARetTotal?: number;
  totIVARetTotal?: number;
  totMntTotal: number;
  totOpIVANoRetenido?: number;
  totIVANoRetenido?: number;
};

export type PurchaseBookModel = {
  status: "PRE_CAF_NOT_READY";
  attention: "4959700";
  schemaStatus: typeof SALES_BOOK_SCHEMA_STATUS;
  caratula: {
    rutEmisorLibro: string;
    rutEnvia: string;
    periodoTributario: string;
    fchResol: string;
    nroResol: number;
    tipoOperacion: "COMPRA";
    tipoLibro: "ESPECIAL";
    tipoEnvio: "TOTAL";
    folioNotificacion: 2;
  };
  resumenPeriodo: PurchaseBookTotals[];
  detalle: PurchaseBookDetail[];
};

export const PURCHASE_BOOK_SET_4959700: readonly PurchaseBookSourceEntry[] = [
  { caseId: "4959700-1", tpoDoc: 30, folio: 234, observation: "FACTURA DEL GIRO CON DERECHO A CREDITO", mntNeto: 5031, mntExe: 0, vatKind: "recoverable", expectedTotal: 5987 },
  { caseId: "4959700-2", tpoDoc: 33, folio: 32, observation: "FACTURA DEL GIRO CON DERECHO A CREDITO", mntNeto: 4010, mntExe: 7933, vatKind: "recoverable", expectedTotal: 12705 },
  { caseId: "4959700-3", tpoDoc: 30, folio: 781, observation: "FACTURA CON IVA USO COMUN", mntNeto: 29589, mntExe: 0, vatKind: "common_use", commonVatFactor: 0.6, expectedTotal: 35211 },
  { caseId: "4959700-4", tpoDoc: 60, folio: 451, observation: "NOTA DE CREDITO POR DESCUENTO A FACTURA 234", mntNeto: 2612, mntExe: 0, vatKind: "recoverable", expectedTotal: 3108 },
  { caseId: "4959700-5", tpoDoc: 33, folio: 67, observation: "ENTREGA GRATUITA DEL PROVEEDOR", mntNeto: 8952, mntExe: 0, vatKind: "non_recoverable", codIVANoRec: 4, expectedTotal: 10653 },
  { caseId: "4959700-6", tpoDoc: 46, folio: 9, observation: "COMPRA CON RETENCION TOTAL DEL IVA", mntNeto: 9037, mntExe: 0, vatKind: "withholding", codImp: 15, expectedTotal: 9037 },
  { caseId: "4959700-7", tpoDoc: 60, folio: 211, observation: "NOTA DE CREDITO POR DESCUENTO FACTURA ELECTRONICA 32", mntNeto: 2130, mntExe: 0, vatKind: "recoverable", expectedTotal: 2535 },
];

function roundVat(amount: number): number {
  return Math.round(amount * 19 / 100);
}

function assertIntegerMoney(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} debe ser CLP entero no negativo`);
}

function assertExternalData(input: Partial<PurchaseBookExternalData>): PurchaseBookExternalData {
  const missing = [input.rutEmisorLibro ? null : "RutEmisorLibro", input.rutEnvia ? null : "RutEnvia", input.periodoTributario ? null : "PeriodoTributario", input.fchResol ? null : "FchResol", Number.isSafeInteger(input.nroResol) && Number(input.nroResol) >= 0 ? null : "NroResol"].filter(Boolean);
  if (missing.length > 0) throw new Error(`Datos externos Libro de Compras faltantes: ${missing.join(", ")}`);
  if (!/^\d{4}-\d{2}$/.test(String(input.periodoTributario))) throw new Error("PeriodoTributario debe ser YYYY-MM");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.fchResol))) throw new Error("FchResol debe ser YYYY-MM-DD");
  return { rutEmisorLibro: normalizeRut(String(input.rutEmisorLibro)), rutEnvia: normalizeRut(String(input.rutEnvia)), periodoTributario: String(input.periodoTributario), fchResol: String(input.fchResol), nroResol: Number(input.nroResol) };
}

function validateVatExclusivity(entry: PurchaseBookSourceEntry): void {
  const flags = [entry.vatKind === "recoverable", entry.vatKind === "common_use", entry.vatKind === "non_recoverable", entry.vatKind === "withholding"].filter(Boolean).length;
  if (flags > 1) throw new Error(`IVA mutuamente excluyente incumplido: ${entry.caseId}`);
  if (entry.codIVANoRec === 4 && entry.vatKind !== "non_recoverable") throw new Error("CodIVANoRec=4 solo aplica a entrega gratuita");
  if (entry.commonVatFactor !== undefined && (entry.commonVatFactor <= 0 || entry.commonVatFactor > 1)) throw new Error("FctProp debe ser mayor que 0 y menor o igual que 1");
}

function buildDetail(entry: PurchaseBookSourceEntry, provider: PurchaseBookProviderFixture, period: string): PurchaseBookDetail {
  assertIntegerMoney(entry.mntNeto, `${entry.caseId}.MntNeto`);
  assertIntegerMoney(entry.mntExe, `${entry.caseId}.MntExe`);
  if (!Number.isSafeInteger(entry.folio) || entry.folio <= 0) throw new Error(`Folio invalido ${entry.caseId}`);
  validateVatExclusivity(entry);
  const vat = roundVat(entry.mntNeto);
  let mntIVA = 0;
  let ivaUsoComun = 0;
  let ivaNoRec: PurchaseBookDetail["ivaNoRec"];
  let otrosImp: PurchaseBookDetail["otrosImp"];
  let ivaRetTotal = 0;
  let ivaNoRetenido = 0;

  if (entry.vatKind === "recoverable") mntIVA = vat;
  if (entry.vatKind === "common_use") ivaUsoComun = vat;
  if (entry.vatKind === "non_recoverable") ivaNoRec = { codIVANoRec: 4, mntIVANoRec: vat };
  if (entry.vatKind === "withholding") {
    mntIVA = vat;
    otrosImp = { codImp: 15, tasaImp: 19, mntImp: vat };
    ivaRetTotal = vat;
    ivaNoRetenido = 0;
  }

  if (entry.vatKind === "withholding" && ivaRetTotal !== vat) throw new Error("Retencion total debe igualar IVA calculado");
  if (entry.vatKind === "withholding" && ivaNoRetenido !== 0) throw new Error("IVANoRetenido debe ser 0 en retencion total");

  const calculatedTotal = entry.vatKind === "withholding" ? entry.mntNeto : entry.mntExe + entry.mntNeto + vat;
  if (calculatedTotal !== entry.expectedTotal) throw new Error(`Cuadratura incorrecta ${entry.caseId}: ${calculatedTotal} != ${entry.expectedTotal}`);

  return {
    caseId: entry.caseId,
    tpoDoc: entry.tpoDoc,
    folio: entry.folio,
    fchDoc: `${period}-01`,
    providerRut: normalizeRut(provider.rut),
    providerName: provider.name,
    observation: entry.observation,
    mntExe: entry.mntExe,
    mntNeto: entry.mntNeto,
    mntIVA,
    ivaUsoComun,
    ivaNoRec,
    otrosImp,
    ivaRetTotal,
    ivaNoRetenido,
    mntTotal: entry.expectedTotal,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function summarize(tpoDoc: 30 | 33 | 46 | 60, details: readonly PurchaseBookDetail[]): PurchaseBookTotals {
  const items = details.filter((item) => item.tpoDoc === tpoDoc);
  const commonVat = sum(items.map((item) => item.ivaUsoComun));
  const nonRec = sum(items.map((item) => item.ivaNoRec?.mntIVANoRec ?? 0));
  const ivaRetTotal = sum(items.map((item) => item.ivaRetTotal));
  const ivaNoRetenido = sum(items.map((item) => item.ivaNoRetenido));
  const total: PurchaseBookTotals = {
    tpoDoc,
    totDoc: items.length,
    totMntExe: sum(items.map((item) => item.mntExe)),
    totMntNeto: sum(items.map((item) => item.mntNeto)),
    totMntIVA: sum(items.map((item) => item.mntIVA)),
    totMntTotal: sum(items.map((item) => item.mntTotal)),
  };
  const recoverableOps = items.filter((item) => item.mntIVA > 0).length;
  if (recoverableOps > 0) total.totOpIVARec = recoverableOps;
  if (nonRec > 0) total.totIVANoRec = { codIVANoRec: 4, totOpIVANoRec: items.filter((item) => item.ivaNoRec).length, totMntIVANoRec: nonRec };
  if (commonVat > 0) {
    total.totOpIVAUsoComun = items.filter((item) => item.ivaUsoComun > 0).length;
    total.totIVAUsoComun = commonVat;
    total.fctProp = "0.600";
    total.totCredIVAUsoComun = Math.round(commonVat * 0.6);
  }
  const totalOtherImp = sum(items.map((item) => item.otrosImp?.mntImp ?? 0));
  if (totalOtherImp > 0) total.totOtrosImp = { codImp: 15, totMntImp: totalOtherImp };
  if (ivaRetTotal > 0) {
    total.totOpIVARetTotal = items.filter((item) => item.ivaRetTotal > 0).length;
    total.totIVARetTotal = ivaRetTotal;
    total.totOpIVANoRetenido = items.filter((item) => item.otrosImp).length;
    total.totIVANoRetenido = ivaNoRetenido;
  }
  return total;
}

function validateSummary(details: readonly PurchaseBookDetail[], totals: readonly PurchaseBookTotals[]): void {
  for (const total of totals) {
    const expected = summarize(total.tpoDoc, details);
    if (JSON.stringify(expected) !== JSON.stringify(total)) throw new Error(`Resumen no cuadra para TpoDoc ${total.tpoDoc}`);
  }
}

export function buildPurchaseBookModel(input: {
  externalData: Partial<PurchaseBookExternalData>;
  providers: Partial<Record<PurchaseBookSourceEntry["caseId"], PurchaseBookProviderFixture>>;
  salesBookPeriod: string;
  entries?: readonly PurchaseBookSourceEntry[];
}): PurchaseBookModel {
  const externalData = assertExternalData(input.externalData);
  if (externalData.periodoTributario !== input.salesBookPeriod) throw new Error("Periodo Libro de Compras debe igualar Libro de Ventas");
  const entries = input.entries ?? PURCHASE_BOOK_SET_4959700;
  if (entries.length !== 7) throw new Error("Libro de Compras requiere exactamente siete detalles");
  const expectedTypes = [30, 33, 30, 60, 33, 46, 60];
  const expectedFolios = [234, 32, 781, 451, 67, 9, 211];
  entries.forEach((entry, index) => {
    if (entry.tpoDoc !== expectedTypes[index] || entry.folio !== expectedFolios[index]) throw new Error("Codigos o folios del set 4959700 no coinciden");
  });
  const detalle = entries.map((entry) => {
    const provider = input.providers[entry.caseId];
    if (!provider) throw new Error(`Proveedor fixture faltante ${entry.caseId}`);
    return buildDetail(entry, provider, externalData.periodoTributario);
  });
  const resumenPeriodo = [summarize(30, detalle), summarize(33, detalle), summarize(60, detalle), summarize(46, detalle)];
  validateSummary(detalle, resumenPeriodo);
  return {
    status: "PRE_CAF_NOT_READY",
    attention: "4959700",
    schemaStatus: SALES_BOOK_SCHEMA_STATUS,
    caratula: {
      rutEmisorLibro: externalData.rutEmisorLibro,
      rutEnvia: externalData.rutEnvia,
      periodoTributario: externalData.periodoTributario,
      fchResol: externalData.fchResol,
      nroResol: externalData.nroResol,
      tipoOperacion: "COMPRA",
      tipoLibro: "ESPECIAL",
      tipoEnvio: "TOTAL",
      folioNotificacion: 2,
    },
    resumenPeriodo,
    detalle,
  };
}

function totalsXml(total: PurchaseBookTotals): string {
  const lines = [
    "      <TotalesPeriodo>",
    `        <TpoDoc>${total.tpoDoc}</TpoDoc>`,
    "        <TpoImp>1</TpoImp>",
    `        <TotDoc>${total.totDoc}</TotDoc>`,
    `        <TotMntExe>${total.totMntExe}</TotMntExe>`,
    `        <TotMntNeto>${total.totMntNeto}</TotMntNeto>`,
  ];
  if (total.totOpIVARec) lines.push(`        <TotOpIVARec>${total.totOpIVARec}</TotOpIVARec>`);
  lines.push(`        <TotMntIVA>${total.totMntIVA}</TotMntIVA>`);
  if (total.totIVANoRec) lines.push("        <TotIVANoRec>", `          <CodIVANoRec>${total.totIVANoRec.codIVANoRec}</CodIVANoRec>`, `          <TotOpIVANoRec>${total.totIVANoRec.totOpIVANoRec}</TotOpIVANoRec>`, `          <TotMntIVANoRec>${total.totIVANoRec.totMntIVANoRec}</TotMntIVANoRec>`, "        </TotIVANoRec>");
  if (total.totOpIVAUsoComun) lines.push(`        <TotOpIVAUsoComun>${total.totOpIVAUsoComun}</TotOpIVAUsoComun>`, `        <TotIVAUsoComun>${total.totIVAUsoComun}</TotIVAUsoComun>`, `        <FctProp>${total.fctProp}</FctProp>`, `        <TotCredIVAUsoComun>${total.totCredIVAUsoComun}</TotCredIVAUsoComun>`);
  if (total.totOtrosImp) lines.push("        <TotOtrosImp>", `          <CodImp>${total.totOtrosImp.codImp}</CodImp>`, `          <TotMntImp>${total.totOtrosImp.totMntImp}</TotMntImp>`, "        </TotOtrosImp>");
  if (total.totOpIVARetTotal) lines.push(`        <TotOpIVARetTotal>${total.totOpIVARetTotal}</TotOpIVARetTotal>`, `        <TotIVARetTotal>${total.totIVARetTotal}</TotIVARetTotal>`);
  lines.push(`        <TotMntTotal>${total.totMntTotal}</TotMntTotal>`);
  if (total.totOpIVANoRetenido) lines.push(`        <TotOpIVANoRetenido>${total.totOpIVANoRetenido}</TotOpIVANoRetenido>`, `        <TotIVANoRetenido>${total.totIVANoRetenido}</TotIVANoRetenido>`);
  lines.push("      </TotalesPeriodo>");
  return lines.join("\n");
}

function detailXml(detail: PurchaseBookDetail): string {
  const lines = [
    "      <Detalle>",
    `        <TpoDoc>${detail.tpoDoc}</TpoDoc>`,
    `        <NroDoc>${detail.folio}</NroDoc>`,
    "        <TpoImp>1</TpoImp>",
    "        <TasaImp>19</TasaImp>",
    `        <FchDoc>${escapeXml(detail.fchDoc)}</FchDoc>`,
    `        <RUTDoc>${escapeXml(detail.providerRut)}</RUTDoc>`,
    `        <RznSoc>${escapeXml(detail.providerName)}</RznSoc>`,
    `        <MntExe>${detail.mntExe}</MntExe>`,
    `        <MntNeto>${detail.mntNeto}</MntNeto>`,
  ];
  if (detail.mntIVA > 0) lines.push(`        <MntIVA>${detail.mntIVA}</MntIVA>`);
  if (detail.ivaNoRec) lines.push("        <IVANoRec>", `          <CodIVANoRec>${detail.ivaNoRec.codIVANoRec}</CodIVANoRec>`, `          <MntIVANoRec>${detail.ivaNoRec.mntIVANoRec}</MntIVANoRec>`, "        </IVANoRec>");
  if (detail.ivaUsoComun > 0) lines.push(`        <IVAUsoComun>${detail.ivaUsoComun}</IVAUsoComun>`);
  if (detail.otrosImp) lines.push("        <OtrosImp>", `          <CodImp>${detail.otrosImp.codImp}</CodImp>`, `          <TasaImp>${detail.otrosImp.tasaImp}</TasaImp>`, `          <MntImp>${detail.otrosImp.mntImp}</MntImp>`, "        </OtrosImp>");
  if (detail.ivaRetTotal > 0) lines.push(`        <IVARetTotal>${detail.ivaRetTotal}</IVARetTotal>`);
  lines.push(`        <MntTotal>${detail.mntTotal}</MntTotal>`);
  if (detail.otrosImp) lines.push(`        <IVANoRetenido>${detail.ivaNoRetenido}</IVANoRetenido>`);
  lines.push("      </Detalle>");
  return lines.join("\n");
}

function fixtureSignatureXml(): string {
  return [
    '  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">',
    '    <SignedInfo>',
    '      <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>',
    '      <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>',
    '      <Reference URI="#LibroCompras-4959700-PRECAF">',
    '        <DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>',
    '        <DigestValue>AA==</DigestValue>',
    '      </Reference>',
    '    </SignedInfo>',
    '    <SignatureValue>AA==</SignatureValue>',
    '    <KeyInfo>',
    '      <KeyValue>',
    '        <RSAKeyValue>',
    '          <Modulus>AA==</Modulus>',
    '          <Exponent>AQAB</Exponent>',
    '        </RSAKeyValue>',
    '      </KeyValue>',
    '      <X509Data>',
    '        <X509Certificate>AA==</X509Certificate>',
    '      </X509Data>',
    '    </KeyInfo>',
    '  </Signature>',
  ].join("\n");
}

export function serializePurchaseBookXml(model: PurchaseBookModel, options: { id?: string; includeSchemaLocation?: boolean; includeFixtureSignature?: boolean; signatureXml?: string; timestamp?: string } = {}): string {
  const id = options.id ?? "LibroCompras-4959700-PRECAF";
  const root = options.includeSchemaLocation
    ? '<LibroCompraVenta xmlns="http://www.sii.cl/SiiDte" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte LibroCV_v10.xsd" version="1.0">'
    : '<LibroCompraVenta xmlns="http://www.sii.cl/SiiDte" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" version="1.0">';
  return [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    root,
    `  <EnvioLibro ID="${escapeXml(id)}">`,
    '    <Caratula>',
    `      <RutEmisorLibro>${escapeXml(model.caratula.rutEmisorLibro)}</RutEmisorLibro>`,
    `      <RutEnvia>${escapeXml(model.caratula.rutEnvia)}</RutEnvia>`,
    `      <PeriodoTributario>${escapeXml(model.caratula.periodoTributario)}</PeriodoTributario>`,
    `      <FchResol>${escapeXml(model.caratula.fchResol)}</FchResol>`,
    `      <NroResol>${model.caratula.nroResol}</NroResol>`,
    `      <TipoOperacion>${model.caratula.tipoOperacion}</TipoOperacion>`,
    `      <TipoLibro>${model.caratula.tipoLibro}</TipoLibro>`,
    `      <TipoEnvio>${model.caratula.tipoEnvio}</TipoEnvio>`,
    `      <FolioNotificacion>${model.caratula.folioNotificacion}</FolioNotificacion>`,
    '    </Caratula>',
    '    <ResumenPeriodo>',
    model.resumenPeriodo.map(totalsXml).join("\n"),
    '    </ResumenPeriodo>',
    model.detalle.map(detailXml).join("\n"),
    `    <TmstFirma>${escapeXml(options.timestamp ?? "2026-07-19T00:00:00")}</TmstFirma>`,
    '  </EnvioLibro>',
    options.signatureXml ?? (options.includeFixtureSignature ? fixtureSignatureXml() : ''),
    '</LibroCompraVenta>',
  ].filter((line) => line !== '').join("\n");
}
