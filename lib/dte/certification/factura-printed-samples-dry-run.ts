import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from "@xmldom/xmldom";
import { jsPDF } from "jspdf";

import { encodeIso88591Strict, FACTURA_SET_FIXTURE_OUTPUT_DIR, runFacturaSetDryRun, type FacturaSetDryRunOptions } from "./factura-set-dry-run";

const OUTPUT_DIR = "/home/verf/secure/dte-lab/printed-samples-4959698-dry-run";
const MANIFEST = "manifest-4959698-PRINTED-FIXTURE-SIN-VALIDEZ.json";
const AUDIT = "audit-4959698-PRINTED-FIXTURE-SIN-VALIDEZ.json";
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const BARCODE_X = 60;
const BARCODE_Y = 650;
const BARCODE_WIDTH = 250;
const BARCODE_HEIGHT = 90;
const MIN_BARCODE_WIDTH = 5 / 2.54 * 72;
const MIN_BARCODE_HEIGHT = 2 / 2.54 * 72;
const MIN_LEFT_MARGIN = 2 / 2.54 * 72;
const SOURCE_NAMES = Array.from({ length: 8 }, (_, index) => `4959698-${index + 1}-DTE-FIXTURE-SIN-VALIDEZ.xml`);
const COMMERCIAL_TEXT = /pago|inter[eé]s|garant[ií]a|contrato|despacho|vencimiento|cuenta bancaria/i;

export type PrintedSamplesOptions = FacturaSetDryRunOptions & {
  printedOutputDir?: string;
  sourceDir?: string;
  skipSourceGeneration?: boolean;
  overrides?: FacturaSetDryRunOptions["overrides"] & Partial<{
    extraPage: boolean; barcodeWidth: number; barcodeX: number; corruptBarcode: boolean; mismatchedTed: boolean;
    alterTotals: boolean; omitDiscounts: boolean; omitReferences: boolean; omitCedibleLabel: boolean;
    omitReceiptBox: boolean; receiptOnTaxCopy: boolean; clippedContent: boolean; commercialText: boolean;
    artifactInsideRepo: boolean; realCafPath: string; realCertificatePath: string;
  }>;
};

export type PrintedSamplesResult = {
  environment: "certification"; fixtureMode: true; sourceDte: 8; pdfFiles: 12; singlePage: "12/12";
  type33TaxCopies: 4; type33CedibleCopies: 4; type61Copies: 3; type56Copies: 1;
  pdf417Generated: "12/12"; pdf417Decoded: "12/12"; tedRoundTrip: "12/12";
  pageDimensions: "valid"; margins: "valid"; discountsVisible: "valid"; totalsVisible: "valid";
  referencesVisible: "valid"; cedibleReceiptBox: "4/4"; nonCedibleReceiptBoxAbsent: "8/8";
  noCommercialText: true; visualQa: "valid"; realCaf: false; siiContacted: false; readyToDownloadCaf: false;
};

type Detail = { name: string; description: string; quantity: string; price: string; amount: string; exempt: boolean; discountPct: string; discountAmount: string };
type Reference = { type: string; folio: string; date: string; code: string; reason: string };
export type SourceDte = {
  caseId: string; type: number; folio: string; date: string; issuerName: string; issuerRut: string; issuerActivity: string;
  issuerAddress: string; issuerCommune: string; issuerCity: string; receiverName: string; receiverRut: string;
  receiverActivity: string; receiverAddress: string; receiverCommune: string; receiverCity: string;
  net: string; exempt: string; vatRate: string; vat: string; total: string; details: Detail[]; references: Reference[];
  globalDiscount: string[]; tedXml: string; tedBytes: Buffer;
};
export type CopySpec = { source: SourceDte; cedible: boolean; fileName: string };
export type LayoutAudit = { pageCount: number; width: number; height: number; barcodeX: number; barcodeY: number; barcodeWidth: number; barcodeHeight: number; cedible: boolean; receiptBox: boolean; clippedContent: boolean; text: string; decodedTedMatches: boolean };

export const PRINTED_RECEIPT_DECLARATION = "El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4, y la letra c) del Art. 5 de la Ley 19.983, acredita que la entrega de mercaderias o servicio(s) prestado(s) ha(n) sido recibido(s).";

function fail(message: string): never { throw new Error(message); }
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function money(value: string): string { return Number(value || "0").toLocaleString("es-CL"); }
function formatChileanRut(value: string): string {
  const normalized = value.replace(/[.\s]/g, "").toUpperCase();
  const match = normalized.match(/^(\d{1,8})-?([\dK])$/);
  if (!match) fail("RUT invalido para impresion");
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${match[2]}`;
}
function nodeText(parent: XmlDocument | XmlElement, tag: string, required = false): string {
  const value = parent.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
  if (required && !value) fail(`campo XML final ausente: ${tag}`);
  return value;
}
function directChildren(parent: XmlElement, tag: string): XmlElement[] {
  return Array.from({ length: parent.childNodes.length }, (_, index) => parent.childNodes.item(index)).filter((node): node is XmlElement => node?.nodeType === 1 && (node as XmlElement).tagName === tag);
}
export function parseFinalDte(path: string, caseId: string): SourceDte {
  const bytes = readFileSync(path); const xml = bytes.toString("latin1");
  if (!encodeIso88591Strict(xml).equals(bytes) || !xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')) fail("XML fuente no es ISO-8859-1 final");
  const tedXml = xml.match(/<TED version="1\.0">[\s\S]*?<\/TED>/)?.[0] ?? fail("TED exacto ausente en XML final");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) fail("XML DTE final invalido");
  const encabezado = document.getElementsByTagName("Encabezado")[0] ?? fail("Encabezado ausente");
  const detalles = Array.from(document.getElementsByTagName("Detalle"));
  const references = Array.from(document.getElementsByTagName("Referencia"));
  const globals = Array.from(document.getElementsByTagName("DscRcgGlobal"));
  return {
    caseId, type: Number(nodeText(encabezado, "TipoDTE", true)), folio: nodeText(encabezado, "Folio", true), date: nodeText(encabezado, "FchEmis", true),
    issuerName: nodeText(encabezado, "RznSoc", true), issuerRut: nodeText(encabezado, "RUTEmisor", true), issuerActivity: nodeText(encabezado, "GiroEmis", true),
    issuerAddress: nodeText(encabezado, "DirOrigen", true), issuerCommune: nodeText(encabezado, "CmnaOrigen", true), issuerCity: nodeText(encabezado, "CiudadOrigen"),
    receiverName: nodeText(encabezado, "RznSocRecep", true), receiverRut: nodeText(encabezado, "RUTRecep", true), receiverActivity: nodeText(encabezado, "GiroRecep"),
    receiverAddress: nodeText(encabezado, "DirRecep"), receiverCommune: nodeText(encabezado, "CmnaRecep"), receiverCity: nodeText(encabezado, "CiudadRecep"),
    net: nodeText(encabezado, "MntNeto"), exempt: nodeText(encabezado, "MntExe"), vatRate: nodeText(encabezado, "TasaIVA"), vat: nodeText(encabezado, "IVA"), total: nodeText(encabezado, "MntTotal", true),
    details: detalles.map((detail) => ({ name: nodeText(detail, "NmbItem", true), description: nodeText(detail, "DscItem"), quantity: nodeText(detail, "QtyItem") || "0", price: nodeText(detail, "PrcItem") || "0", amount: nodeText(detail, "MontoItem", true), exempt: nodeText(detail, "IndExe") === "1", discountPct: nodeText(detail, "DescuentoPct"), discountAmount: nodeText(detail, "DescuentoMonto") })),
    references: references.map((reference) => ({ type: nodeText(reference, "TpoDocRef", true), folio: nodeText(reference, "FolioRef", true), date: nodeText(reference, "FchRef", true), code: nodeText(reference, "CodRef"), reason: nodeText(reference, "RazonRef", true) })),
    globalDiscount: globals.map((global) => directChildren(global, "ValorDR").map((item) => item.textContent?.trim() ?? "").join(" ")).filter(Boolean),
    tedXml, tedBytes: encodeIso88591Strict(tedXml),
  };
}

function assertEnvironment(options: PrintedSamplesOptions, repoRoot: string): void {
  const env = options.env ?? process.env;
  if (env.DTE_SII_ENV !== "certification") fail("DTE_SII_ENV debe ser certification para PRE-CAF 11");
  if (env.DTE_MODE === "production") fail("production bloqueado para PRE-CAF 11");
  if (env.DTE_CAF_PATH || env.DTE_CAF_PRIVATE_KEY_PATH || env.DTE_CERT_PATH || env.DTE_PRIVATE_KEY_PATH || options.overrides?.realCafPath || options.overrides?.realCertificatePath) fail("CAF/certificado real bloqueado para PRE-CAF 11");
  if (env.DTE_SII_TOKEN || env.DTE_TRACK_ID || env.DTE_SII_ENABLE_SUBMIT === "true") fail("token/submit/track_id bloqueado para PRE-CAF 11");
  const output = resolve(options.printedOutputDir ?? env.DTE_PRINTED_SAMPLES_OUTPUT_DIR ?? OUTPUT_DIR);
  const relative = output.startsWith(`${resolve(repoRoot)}/`) || output === resolve(repoRoot);
  if (relative || options.overrides?.artifactInsideRepo) fail("artefactos impresos dentro del repositorio bloqueados");
}

function specs(sources: SourceDte[]): CopySpec[] {
  const copies: CopySpec[] = [];
  for (const source of sources) {
    copies.push({ source, cedible: false, fileName: `${source.caseId}-T${source.type}-TRIBUTARIO-NO-CEDIBLE-FIXTURE.pdf` });
    if (source.type === 33) copies.push({ source, cedible: true, fileName: `${source.caseId}-T33-CEDIBLE-FIXTURE.pdf` });
  }
  return copies;
}
export function documentName(type: number): string { if (type === 33) return "FACTURA ELECTRÓNICA"; if (type === 61) return "NOTA DE CRÉDITO ELECTRÓNICA"; if (type === 56) return "NOTA DE DÉBITO ELECTRÓNICA"; return fail("tipo DTE impreso no soportado"); }
export function referenceDocumentName(type: string): string { const numeric = Number(type); if ([33, 56, 61].includes(numeric)) return documentName(numeric); return "DOCUMENTO TRIBUTARIO TIPO " + type; }
function safeText(pdf: jsPDF, text: string, x: number, y: number, maxWidth = 520): number {
  const lines = pdf.splitTextToSize(text, maxWidth) as string[]; pdf.text(lines, x, y); return y + lines.length * 9;
}

async function barcodePng(ted: Buffer, corrupt: boolean): Promise<Buffer> {
  const { writeBarcode } = await import("zxing-wasm/writer");
  const output = await writeBarcode(new Uint8Array(ted), { format: "PDF417", scale: 3, options: "ecLevel=2,columns=5" });
  if (output.error || !output.image) fail("generacion PDF417 fixture fallo");
  const result = Buffer.from(await output.image.arrayBuffer());
  if (corrupt) result.fill(0, Math.floor(result.length / 3), Math.floor(result.length * 2 / 3));
  return result;
}

export async function buildPdf(spec: CopySpec, options: PrintedSamplesOptions = {}): Promise<{ bytes: Buffer; layout: LayoutAudit }> {
  const source = spec.source; const override = options.overrides;
  const issuerRut = formatChileanRut(source.issuerRut);
  const receiverRut = formatChileanRut(source.receiverRut);
  const barcodeWidth = override?.barcodeWidth ?? BARCODE_WIDTH; const barcodeX = override?.barcodeX ?? BARCODE_X;
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: false });
  pdf.setProperties({ title: "MUESTRA FIXTURE SIN VALIDEZ", subject: "PRE-CAF 11 offline fixture" });
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text(source.issuerName, 36, 38);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.text(`RUT: ${issuerRut}`, 36, 51);
  const issuerAddressY = safeText(pdf, `GIRO: ${source.issuerActivity}`, 36, 62, 350) + 4;
  safeText(pdf, `DIRECCIÓN: ${source.issuerAddress}, ${source.issuerCommune} ${source.issuerCity}`, 36, issuerAddressY, 350);
  pdf.setDrawColor(190, 0, 0); pdf.setLineWidth(1.4); pdf.rect(405, 25, 170, 88);
  pdf.setTextColor(160, 0, 0); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.text(`RUT ${issuerRut}`, 420, 45);
  pdf.text(documentName(source.type), 420, 64, { maxWidth: 145 }); pdf.text(`N° ${source.folio}`, 420, 88); pdf.text("S.I.I. - LA SERENA", 420, 103); pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(8); pdf.text(`FECHA EMISIÓN: ${source.date}`, 36, 119); pdf.line(36, 126, 576, 126);
  let y = 139; pdf.setFont("helvetica", "bold"); pdf.text("RECEPTOR", 36, y); pdf.setFont("helvetica", "normal");
  y = safeText(pdf, `${source.receiverName} | RUT ${receiverRut}`, 36, y + 11);
  y = safeText(pdf, `GIRO: ${source.receiverActivity}`, 36, y); y = safeText(pdf, `DIRECCIÓN: ${source.receiverAddress}, ${source.receiverCommune}, ${source.receiverCity}`, 36, y);
  y += 5; pdf.line(36, y, 576, y); y += 11; pdf.setFont("helvetica", "bold"); pdf.text("DETALLE", 36, y); pdf.text("AF/EX", 330, y); pdf.text("CANT.", 370, y); pdf.text("PRECIO", 425, y); pdf.text("MONTO", 510, y); y += 10;
  pdf.setFont("helvetica", "normal");
  for (const detail of source.details) {
    y = safeText(pdf, detail.name + (detail.description ? ` - ${detail.description}` : ""), 36, y, 285) - 9;
    pdf.text(detail.exempt ? "EX" : "AF", 334, y); pdf.text(detail.quantity, 372, y); pdf.text(money(detail.price), 425, y); pdf.text(money(detail.amount), 510, y);
    y += 10;
    if (!override?.omitDiscounts && (detail.discountPct || detail.discountAmount)) { pdf.setFontSize(7); pdf.text(`DESCUENTO LÍNEA ${detail.discountPct ? `${detail.discountPct}%` : ""} ${detail.discountAmount ? `$${money(detail.discountAmount)}` : ""}`, 52, y); pdf.setFontSize(8); y += 9; }
  }
  if (!override?.omitDiscounts) for (const discount of source.globalDiscount) { pdf.text(`DESCUENTO GLOBAL AFECTO: ${discount}%`, 52, y); y += 9; }
  if (!override?.omitReferences && source.references.length) {
    y += 3; pdf.setFont("helvetica", "bold"); pdf.text("REFERENCIAS", 36, y); pdf.setFont("helvetica", "normal"); y += 9;
    for (const ref of source.references) { y = safeText(pdf, referenceDocumentName(ref.type) + " | Folio " + ref.folio + " | Fecha " + ref.date + " | Motivo: " + ref.reason + (ref.code ? " | Código " + ref.code : ""), 36, y, 535); }
  }
  const printedTotal = override?.alterTotals ? String(Number(source.total) + 1) : source.total;
  const totalsY = Math.max(y + 7, 470); const vatRate = source.vatRate || (source.vat ? "19" : "0"); pdf.line(380, totalsY - 10, 576, totalsY - 10); pdf.text("NETO: $" + money(source.net), 400, totalsY); pdf.text("EXENTO: $" + money(source.exempt), 400, totalsY + 12); pdf.text("IVA " + vatRate + "%: $" + money(source.vat), 400, totalsY + 24); pdf.setFont("helvetica", "bold"); pdf.text("TOTAL: $" + money(printedTotal), 400, totalsY + 38);
  let receiptBox = false;
  if (spec.cedible && !override?.omitReceiptBox) { receiptBox = true; pdf.setFontSize(7); pdf.rect(36, 510, 355, 112); pdf.text("Acuse de Recibo", 44, 522); pdf.setFont("helvetica", "normal"); pdf.text("Nombre: ____________________  RUT: ____________________", 44, 537); pdf.text("Fecha: _____________________  Firma: __________________", 44, 551); pdf.text("Recinto: ______________________________________________", 44, 565); const declaration = pdf.splitTextToSize(PRINTED_RECEIPT_DECLARATION, 338) as string[]; pdf.text(declaration, 44, 580); }
  if (!spec.cedible && override?.receiptOnTaxCopy) { receiptBox = true; pdf.rect(36, 530, 335, 40); pdf.text("Acuse de Recibo", 44, 545); }
  if (spec.cedible && !override?.omitCedibleLabel) { pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.text("CEDIBLE", 500, 625); }
  if (override?.commercialText) pdf.text("CONDICIONES DE PAGO COMERCIALES", 36, 625);
  const barcodeSource = override?.mismatchedTed ? Buffer.from(source.tedBytes).fill(0x41, 0, Math.min(8, source.tedBytes.length)) : source.tedBytes;
  const barcode = await barcodePng(barcodeSource, Boolean(override?.corruptBarcode));
  pdf.addImage(barcode, "PNG", barcodeX, BARCODE_Y, barcodeWidth, BARCODE_HEIGHT);
  pdf.setFontSize(9); pdf.setFont("helvetica", "bold"); pdf.text("Timbre Electrónico SII", barcodeX + 65, BARCODE_Y + BARCODE_HEIGHT + 12);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.text("Res. 0 de 2026 - Verifique documento: www.sii.cl", barcodeX + 30, BARCODE_Y + BARCODE_HEIGHT + 23);
  if (override?.clippedContent) pdf.text("CONTENIDO FUERA", PAGE_WIDTH + 5, 300);
  if (override?.extraPage) { pdf.addPage("letter"); pdf.text("PÁGINA EXTRA", 36, 36); }
  const bytes = Buffer.from(pdf.output("arraybuffer"));
  return { bytes, layout: { pageCount: pdf.getNumberOfPages(), width: PAGE_WIDTH, height: PAGE_HEIGHT, barcodeX, barcodeY: BARCODE_Y, barcodeWidth, barcodeHeight: BARCODE_HEIGHT, cedible: spec.cedible, receiptBox, clippedContent: Boolean(override?.clippedContent), text: "", decodedTedMatches: false } };
}

export async function renderAndAudit(pdfBytes: Buffer, pngPath: string | null, layout: LayoutAudit, spec: CopySpec): Promise<LayoutAudit> {
  const { default: mupdf } = await import("mupdf");
  const document = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  if (document.countPages() !== 1 || layout.pageCount !== 1) fail("PDF debe tener exactamente una pagina");
  const page = document.loadPage(0); const bounds = page.getBounds();
  if (Math.abs(bounds[2] - bounds[0] - PAGE_WIDTH) > 1 || Math.abs(bounds[3] - bounds[1] - PAGE_HEIGHT) > 1) fail("dimensiones de pagina invalidas");
  const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
  const png = Buffer.from(pixmap.asPNG()); if (pngPath) writeFileSync(pngPath, png, { mode: 0o600 });
  const text = page.toStructuredText().asText().replace(/\s+/g, " ").trim(); layout.text = text;
  if (COMMERCIAL_TEXT.test(text)) fail("texto comercial ajeno detectado");
  const required = [documentName(spec.source.type), spec.source.folio, spec.source.date, spec.source.issuerName, formatChileanRut(spec.source.issuerRut), spec.source.issuerActivity, spec.source.issuerAddress, spec.source.issuerCommune, spec.source.receiverName, formatChileanRut(spec.source.receiverRut), spec.source.receiverActivity, spec.source.receiverAddress, money(spec.source.total), "Timbre Electrónico SII", "Res. 0 de 2026", "Verifique documento: www.sii.cl"];
  for (const token of required) if (!text.includes(token)) fail("contenido tributario requerido ausente en PDF final");
  if (spec.source.details.some((item) => item.discountPct || item.discountAmount) && !text.includes("DESCUENTO LÍNEA")) fail("descuento por linea omitido");
  if (spec.source.globalDiscount.length && !text.includes("DESCUENTO GLOBAL AFECTO")) fail("descuento global omitido");
  if (spec.source.references.length && spec.source.references.some((ref) => !text.includes(referenceDocumentName(ref.type)) || !text.includes(ref.folio) || !text.includes(ref.date) || !text.includes(ref.reason))) fail("referencias omitidas");
  if (spec.cedible && (!text.includes("CEDIBLE") || !layout.receiptBox || !text.includes("Acuse de Recibo") || !text.includes(PRINTED_RECEIPT_DECLARATION))) fail("copia cedible incompleta");
  if (!spec.cedible && (layout.receiptBox || text.includes("CEDIBLE") || text.includes("Acuse de Recibo"))) fail("acuse o CEDIBLE presente en copia no cedible");
  if (layout.barcodeWidth < MIN_BARCODE_WIDTH || layout.barcodeHeight < MIN_BARCODE_HEIGHT) fail("PDF417 inferior al minimo");
  if (layout.barcodeWidth > 9 / 2.54 * 72 || layout.barcodeHeight > 4 / 2.54 * 72) fail("dimensiones PDF417 fuera de rango");
  if (layout.barcodeX < MIN_LEFT_MARGIN || layout.barcodeX + layout.barcodeWidth > PAGE_WIDTH || layout.barcodeY + layout.barcodeHeight > PAGE_HEIGHT) fail("PDF417 fuera de margen/pagina");
  if (layout.clippedContent || /CONTENIDO FUERA/.test(text)) fail("contenido recortado o fuera de pagina");
  const { readBarcodes } = await import("zxing-wasm/reader"); const decoded = await readBarcodes(new Uint8Array(png), { formats: ["PDF417"], tryHarder: true, maxNumberOfSymbols: 1 });
  if (decoded.length !== 1) fail("PDF417 final ilegible o corrupto");
  const decodedBytes = Buffer.from(decoded[0].bytes);
  if (!decodedBytes.equals(spec.source.tedBytes)) fail("TED decodificado no coincide byte a byte con XML final");
  layout.decodedTedMatches = true;
  return layout;
}

export async function runPrintedSamplesDryRun(options: PrintedSamplesOptions = {}): Promise<PrintedSamplesResult> {
  const env = options.env ?? process.env; const repoRoot = options.repoRoot ?? process.cwd(); assertEnvironment(options, repoRoot);
  const sourceDir = resolve(options.sourceDir ?? env.DTE_FACTURA_SET_DRY_RUN_OUTPUT_DIR ?? FACTURA_SET_FIXTURE_OUTPUT_DIR);
  if (!options.skipSourceGeneration) runFacturaSetDryRun({ ...options, env, repoRoot, outputDir: sourceDir });
  const sources = SOURCE_NAMES.map((name, index) => parseFinalDte(join(sourceDir, name), `4959698-${index + 1}`));
  if (sources.filter((item) => item.type === 33).length !== 4 || sources.filter((item) => item.type === 61).length !== 3 || sources.filter((item) => item.type === 56).length !== 1) fail("composicion fuente DTE invalida");
  if (sources.some((item) => item.issuerName !== "R&G SPA")) fail("emisor impreso fixture no corresponde a R&G SPA");
  const outputDir = resolve(options.printedOutputDir ?? env.DTE_PRINTED_SAMPLES_OUTPUT_DIR ?? OUTPUT_DIR); mkdirSync(outputDir, { recursive: true, mode: 0o700 }); chmodSync(outputDir, 0o700);
  const files: Array<{ file: string; sha256: string; kind: "pdf" | "png" }> = []; const audits: LayoutAudit[] = [];
  for (const spec of specs(sources)) {
    const built = await buildPdf(spec, options); const pdfPath = join(outputDir, spec.fileName); writeFileSync(pdfPath, built.bytes, { mode: 0o600 });
    files.push({ file: spec.fileName, sha256: sha256(built.bytes), kind: "pdf" });
    const pngName = spec.fileName.replace(/\.pdf$/, "-AUDIT.png"); const pngPath = join(outputDir, pngName); audits.push(await renderAndAudit(built.bytes, pngPath, built.layout, spec));
    files.push({ file: pngName, sha256: sha256(readFileSync(pngPath)), kind: "png" });
  }
  const manifest = { fixtureMode: true, legalValidity: "SIN_VALIDEZ_TRIBUTARIA", files }; writeFileSync(join(outputDir, MANIFEST), JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });
  const audit = { fixtureMode: true, visualQa: "valid", samples: audits.map((item, index) => ({ sample: index + 1, pageCount: item.pageCount, pageWidth: item.width, pageHeight: item.height, barcodeBounds: { x: item.barcodeX, y: item.barcodeY, width: item.barcodeWidth, height: item.barcodeHeight }, cedible: item.cedible, receiptBox: item.receiptBox })) };
  writeFileSync(join(outputDir, AUDIT), JSON.stringify(audit, null, 2), { encoding: "utf8", mode: 0o600 });
  return { environment: "certification", fixtureMode: true, sourceDte: 8, pdfFiles: 12, singlePage: "12/12", type33TaxCopies: 4, type33CedibleCopies: 4, type61Copies: 3, type56Copies: 1, pdf417Generated: "12/12", pdf417Decoded: "12/12", tedRoundTrip: "12/12", pageDimensions: "valid", margins: "valid", discountsVisible: "valid", totalsVisible: "valid", referencesVisible: "valid", cedibleReceiptBox: "4/4", nonCedibleReceiptBoxAbsent: "8/8", noCommercialText: true, visualQa: "valid", realCaf: false, siiContacted: false, readyToDownloadCaf: false };
}
export function formatPrintedSamplesResult(result: PrintedSamplesResult): string { return Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n"); }
