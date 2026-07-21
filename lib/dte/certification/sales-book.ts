import { normalizeRut } from "../rut";
import { escapeXml } from "../xml/escape-xml";
import {
  buildFacturaCertificationDocuments,
  type FacturaCertificationBuildInput,
  type FacturaCertificationCaseId,
  type FacturaCertificationDocument,
} from "./factura-electronica-set";

export const SALES_BOOK_SCHEMA_STATUS = {
  officialXsdPresent: true,
  officialUrl: "https://www.sii.cl/factura_electronica/factura_mercado/schema_iecv.zip",
  schemaFile: "docs/dte-sii/xsd/LibroCV_v10.xsd",
} as const;

export type SalesBookExternalData = {
  rutEmisorLibro: string;
  rutEnvia: string;
  fchResol: string;
  nroResol: number;
};

export type SalesBookDetailFixture = {
  folio: number | "PENDING_REAL_FOLIO";
  recipientRut: string;
  recipientName: string;
};

export type SalesBookBuildInput = FacturaCertificationBuildInput & {
  externalData: Partial<SalesBookExternalData>;
  details: Partial<Record<FacturaCertificationCaseId, SalesBookDetailFixture>>;
};

export type SalesBookCaratula = {
  rutEmisorLibro: string;
  rutEnvia: string;
  periodoTributario: string;
  fchResol: string;
  nroResol: number;
  tipoOperacion: "VENTA";
  tipoLibro: "ESPECIAL";
  tipoEnvio: "TOTAL";
  folioNotificacion: 1;
};

export type SalesBookDetail = {
  caseId: FacturaCertificationCaseId;
  tpoDoc: 33 | 56 | 61;
  folio: number;
  fecha: string;
  recipientRut: string;
  recipientName: string;
  mntExe: number;
  mntNeto: number;
  mntIVA: number;
  tasaImp?: 19;
  mntTotal: number;
};

export type SalesBookTotals = {
  tpoDoc: 33 | 56 | 61;
  totDoc: number;
  totOpExe: number;
  totMntExe: number;
  totMntNeto: number;
  totMntIVA: number;
  totMntTotal: number;
};

export type SalesBookModel = {
  status: "PRE_CAF_NOT_READY";
  attention: "4959699";
  sourceAttention: "4959698";
  schemaStatus: typeof SALES_BOOK_SCHEMA_STATUS;
  caratula: SalesBookCaratula;
  resumenPeriodo: SalesBookTotals[];
  detalle: SalesBookDetail[];
};

const EXPECTED_ORDER: FacturaCertificationCaseId[] = [
  "4959698-1",
  "4959698-2",
  "4959698-3",
  "4959698-4",
  "4959698-5",
  "4959698-6",
  "4959698-7",
  "4959698-8",
];

const EXPECTED_TYPES: Record<FacturaCertificationCaseId, 33 | 56 | 61> = {
  "4959698-1": 33,
  "4959698-2": 33,
  "4959698-3": 33,
  "4959698-4": 33,
  "4959698-5": 61,
  "4959698-6": 61,
  "4959698-7": 61,
  "4959698-8": 56,
};

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} debe tener formato YYYY-MM-DD`);
}

function assertExternalData(input: Partial<SalesBookExternalData>): SalesBookExternalData {
  const missing = [
    input.rutEmisorLibro ? null : "RutEmisorLibro",
    input.rutEnvia ? null : "RutEnvia",
    input.fchResol ? null : "FchResol",
    Number.isSafeInteger(input.nroResol) && Number(input.nroResol) >= 0 ? null : "NroResol",
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Datos externos Libro de Ventas faltantes: ${missing.join(", ")}`);
  assertIsoDate(String(input.fchResol), "FchResol");
  return {
    rutEmisorLibro: normalizeRut(String(input.rutEmisorLibro)),
    rutEnvia: normalizeRut(String(input.rutEnvia)),
    fchResol: String(input.fchResol),
    nroResol: Number(input.nroResol),
  };
}

function assertPositiveFolio(value: number | "PENDING_REAL_FOLIO", caseId: FacturaCertificationCaseId): number {
  if (value === "PENDING_REAL_FOLIO") {
    throw new Error(`Folio pendiente no permitido en XML/modelo final de Libro de Ventas: ${caseId}`);
  }
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Folio debe ser entero positivo: ${caseId}`);
  return value;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function buildDetail(document: FacturaCertificationDocument, fixtures: SalesBookBuildInput["details"]): SalesBookDetail {
  const fixture = fixtures[document.caseId];
  if (!fixture) throw new Error(`Fixture de detalle faltante para ${document.caseId}`);
  const tpoDoc = document.documentTypeCode;
  if (tpoDoc !== EXPECTED_TYPES[document.caseId]) {
    throw new Error(`Tipo DTE inesperado para ${document.caseId}: ${tpoDoc}`);
  }
  const recipientRut = normalizeRut(fixture.recipientRut);
  if (!fixture.recipientName.trim()) throw new Error(`Razon social receptor requerida para ${document.caseId}`);
  return {
    caseId: document.caseId,
    tpoDoc,
    folio: assertPositiveFolio(fixture.folio, document.caseId),
    fecha: document.issueDate,
    recipientRut,
    recipientName: fixture.recipientName,
    mntExe: document.totals.exemptAmount,
    mntNeto: document.totals.netAmount,
    mntIVA: document.totals.vatAmount,
    tasaImp: document.totals.netAmount > 0 ? 19 : undefined,
    mntTotal: document.totals.totalAmount,
  };
}

function summarize(tpoDoc: 33 | 56 | 61, details: readonly SalesBookDetail[]): SalesBookTotals {
  const items = details.filter((item) => item.tpoDoc === tpoDoc);
  return {
    tpoDoc,
    totDoc: items.length,
    totOpExe: items.filter((item) => item.mntExe > 0).length,
    totMntExe: sum(items.map((item) => item.mntExe)),
    totMntNeto: sum(items.map((item) => item.mntNeto)),
    totMntIVA: sum(items.map((item) => item.mntIVA)),
    totMntTotal: sum(items.map((item) => item.mntTotal)),
  };
}

function validateDocuments(documents: readonly FacturaCertificationDocument[]): void {
  if (documents.length !== 8) throw new Error("Libro de Ventas requiere exactamente ocho documentos");
  documents.forEach((document, index) => {
    if (document.caseId !== EXPECTED_ORDER[index]) throw new Error("Orden Libro de Ventas debe ser 4959698-1 a 4959698-8");
  });
  const periods = new Set(documents.map((document) => document.taxPeriod));
  if (periods.size !== 1) throw new Error("Libro de Ventas requiere periodo tributario comun");
}

function validateSummary(details: readonly SalesBookDetail[], totals: readonly SalesBookTotals[]): void {
  for (const total of totals) {
    const expected = summarize(total.tpoDoc, details);
    if (JSON.stringify(expected) !== JSON.stringify(total)) {
      throw new Error(`ResumenPeriodo no cuadra con Detalle para TpoDoc ${total.tpoDoc}`);
    }
  }
}

export function buildSalesBookModelFromDocuments(input: {
  externalData: Partial<SalesBookExternalData>;
  details: SalesBookBuildInput["details"];
  documents: readonly FacturaCertificationDocument[];
}): SalesBookModel {
  const externalData = assertExternalData(input.externalData);
  const documents = input.documents;
  validateDocuments(documents);
  const periodoTributario = documents[0]?.taxPeriod;
  if (!periodoTributario) throw new Error("PeriodoTributario no derivable");
  const detalle = documents.map((document) => buildDetail(document, input.details));
  const resumenPeriodo = [summarize(33, detalle), summarize(61, detalle), summarize(56, detalle)];
  validateSummary(detalle, resumenPeriodo);

  return {
    status: "PRE_CAF_NOT_READY",
    attention: "4959699",
    sourceAttention: "4959698",
    schemaStatus: SALES_BOOK_SCHEMA_STATUS,
    caratula: {
      rutEmisorLibro: externalData.rutEmisorLibro,
      rutEnvia: externalData.rutEnvia,
      periodoTributario,
      fchResol: externalData.fchResol,
      nroResol: externalData.nroResol,
      tipoOperacion: "VENTA",
      tipoLibro: "ESPECIAL",
      tipoEnvio: "TOTAL",
      folioNotificacion: 1,
    },
    resumenPeriodo,
    detalle,
  };
}

export function buildSalesBookModel(input: SalesBookBuildInput): SalesBookModel {
  const documents = buildFacturaCertificationDocuments({
    issueDate: input.issueDate,
    taxPeriod: input.taxPeriod,
    caseOrder: input.caseOrder,
    textCorrection: input.textCorrection,
  });
  return buildSalesBookModelFromDocuments({
    externalData: input.externalData,
    details: input.details,
    documents,
  });
}

function totalsXml(total: SalesBookTotals): string {
  const lines = [
    "      <TotalesPeriodo>",
    `        <TpoDoc>${total.tpoDoc}</TpoDoc>`,
    `        <TotDoc>${total.totDoc}</TotDoc>`,
  ];
  if (total.totOpExe > 0) lines.push(`        <TotOpExe>${total.totOpExe}</TotOpExe>`);
  lines.push(
    `        <TotMntExe>${total.totMntExe}</TotMntExe>`,
    `        <TotMntNeto>${total.totMntNeto}</TotMntNeto>`,
    `        <TotMntIVA>${total.totMntIVA}</TotMntIVA>`,
    `        <TotMntTotal>${total.totMntTotal}</TotMntTotal>`,
    "      </TotalesPeriodo>",
  );
  return lines.join("\n");
}

function detailXml(detail: SalesBookDetail): string {
  return [
    "      <Detalle>",
    `        <TpoDoc>${detail.tpoDoc}</TpoDoc>`,
    `        <NroDoc>${detail.folio}</NroDoc>`,
    detail.tasaImp ? `        <TasaImp>${detail.tasaImp}</TasaImp>` : "",
    `        <FchDoc>${escapeXml(detail.fecha)}</FchDoc>`,
    `        <RUTDoc>${escapeXml(detail.recipientRut)}</RUTDoc>`,
    `        <RznSoc>${escapeXml(detail.recipientName)}</RznSoc>`,
    `        <MntExe>${detail.mntExe}</MntExe>`,
    `        <MntNeto>${detail.mntNeto}</MntNeto>`,
    `        <MntIVA>${detail.mntIVA}</MntIVA>`,
    `        <MntTotal>${detail.mntTotal}</MntTotal>`,
    "      </Detalle>",
  ].filter(Boolean).join("\n");
}

function fixtureSignatureXml(): string {
  return [
    '  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">',
    '    <SignedInfo>',
    '      <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>',
    '      <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>',
    '      <Reference URI="#LibroVentas-4959699-PRECAF">',
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

export function serializeSalesBookXml(model: SalesBookModel, options: { includeFixtureSignature?: boolean; signatureXml?: string; timestamp?: string } = {}): string {
  return [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<LibroCompraVenta xmlns="http://www.sii.cl/SiiDte" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" version="1.0">',
    '  <EnvioLibro ID="LibroVentas-4959699-PRECAF">',
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
