import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { canonicalizeXmlControlled, buildXmlDsigControlled, verifyXmlSignatureControlled } from "../signing/sign-xml.real";
import type { RealXmlSigningConfig } from "../types";
import { buildFacturaCertificationDocuments } from "./factura-electronica-set";
import { encodeIso88591Strict } from "./factura-set-dry-run";
import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";
import { validatePreCafExternalData } from "./pre-caf-external-contract";
import { buildSalesBookModelFromDocuments, serializeSalesBookXml } from "./sales-book";
import { buildPurchaseBookModel, serializePurchaseBookXml } from "./purchase-book";

const OUTPUT_DIR = "/home/verf/secure/dte-lab/books-4959699-4959700-dry-run";
const SALES_FILE = "LibroVentas-4959699-FIXTURE-SIN-VALIDEZ.xml";
const PURCHASE_FILE = "LibroCompras-4959700-FIXTURE-SIN-VALIDEZ.xml";
const MANIFEST_FILE = "manifest-4959699-4959700-FIXTURE-SIN-VALIDEZ.json";
const NS = "http://www.sii.cl/SiiDte";
const SALES_ID = "LibroVentas-4959699-PRECAF";
const PURCHASE_ID = "LibroCompras-4959700-PRECAF";
const TIMESTAMP = "2026-07-19T12:00:00";
const FOLIOS = [330001, 330002, 330003, 330004, 610001, 610002, 610003, 560001];

export type FacturaBooksDryRunOptions = {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  outputDir?: string;
  timestamp?: string;
  skipGeneration?: boolean;
  overrides?: Partial<{
    mismatchedCertificateKey: boolean;
    signatureValueEmpty: boolean;
    signatureValueFake: boolean;
    wrongReferenceUri: boolean;
    wrongPeriod: boolean;
    swappedNotificationFolios: boolean;
    wrongOperation: boolean;
    missingSalesDetail: boolean;
    duplicatePurchaseDetail: boolean;
    realCertificatePath: string;
  }>;
};

export type FacturaBooksDryRunResult = {
  environment: "certification"; fixtureMode: true; salesBook: "4959699"; purchaseBook: "4959700";
  salesDetails: 8; purchaseDetails: 7; salesTotals: "valid"; purchaseTotals: "valid";
  salesSignatureFinalBytes: "valid"; purchaseSignatureFinalBytes: "valid";
  salesXsdFinalBytes: "valid"; purchaseXsdFinalBytes: "valid";
  encoding: "ISO-8859-1"; bom: "absent"; schemaIntegrity: "ok";
  realCertificate: false; siiContacted: false; readyToDownloadCaf: false;
};

type Material = { root: string; keyPath: string; certPath: string; key: string; cert: string };
type Models = { sales: ReturnType<typeof buildSalesBookModelFromDocuments>; purchase: ReturnType<typeof buildPurchaseBookModel> };

function fail(message: string): never { throw new Error(message); }
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function extractElement(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`))?.[0] ?? fail(`${tag} ausente`);
}
function extractFirst(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? fail(`${tag} ausente`);
}
function withNamespace(xml: string): string { return xml.replace("<EnvioLibro ", `<EnvioLibro xmlns="${NS}" `); }

function assertEnvironment(env: NodeJS.ProcessEnv, overrides: FacturaBooksDryRunOptions["overrides"]): void {
  if (env.DTE_SII_ENV !== "certification") fail("DTE_SII_ENV debe ser certification para PRE-CAF 10");
  if (env.DTE_MODE === "production") fail("production bloqueado para PRE-CAF 10");
  if (env.DTE_CAF_PATH || env.DTE_CAF_PRIVATE_KEY_PATH) fail("CAF real bloqueado para PRE-CAF 10");
  if (env.DTE_SII_TOKEN || env.DTE_TRACK_ID || env.DTE_SII_ENABLE_SUBMIT === "true") fail("token/submit/track_id bloqueado para PRE-CAF 10");
  if (env.DTE_CERT_PATH || env.DTE_PRIVATE_KEY_PATH || overrides?.realCertificatePath) fail("rutas de certificado real bloqueadas para PRE-CAF 10");
}

function loadModels(env: NodeJS.ProcessEnv, repoRoot: string): Models {
  const loaded = loadFacturaPreCafInputFromPath({
    inputPath: env.DTE_FACTURA_PRE_CAF_INPUT_PATH,
    repoRoot,
    env: { ...env, DTE_FACTURA_PRE_CAF_ISSUE_DATE: env.DTE_FACTURA_PRE_CAF_ISSUE_DATE ?? env.DTE_CERTIFICATION_ISSUE_DATE },
  });
  if (!loaded.ok || !validatePreCafExternalData(loaded.input).ok) fail("input PRE-CAF externo invalido");
  const issuer = loaded.input.issuer ?? fail("issuer externo ausente");
  const documents = buildFacturaCertificationDocuments({
    issueDate: loaded.issueDate,
    taxPeriod: loaded.taxPeriod,
    textCorrection: { previousBusinessActivity: loaded.input.textCorrection?.giroAnterior, correctedBusinessActivity: loaded.input.textCorrection?.giroCorregido },
  });
  const receiverKeys = ["receiver1", "receiver2", "receiver3", "receiver4", "receiver1", "receiver2", "receiver3", "receiver1"] as const;
  const salesDetails = Object.fromEntries(documents.map((document, index) => {
    const receiver = loaded.input.receivers?.[receiverKeys[index]] ?? fail("receptor externo ausente");
    return [document.caseId, { folio: FOLIOS[index], recipientRut: receiver.rut, recipientName: receiver.razonSocial }];
  }));
  const externalData = { rutEmisorLibro: String(issuer.rutEmisor), rutEnvia: String(issuer.rutEnvia), fchResol: String(issuer.fechaResolucion), nroResol: Number(issuer.numeroResolucion) };
  const sales = buildSalesBookModelFromDocuments({ externalData, details: salesDetails, documents });
  const providers = Object.fromEntries(Object.entries(loaded.input.purchaseProviders ?? {}).map(([caseId, provider]) => [caseId, { rut: String(provider.rut), name: String(provider.razonSocial) }]));
  const purchase = buildPurchaseBookModel({
    externalData: { ...externalData, periodoTributario: loaded.taxPeriod },
    providers,
    salesBookPeriod: loaded.taxPeriod,
  });
  return { sales, purchase };
}

function createMaterial(prefix: string): Material {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const keyPath = join(root, "fixture-key.pem");
  const certPath = join(root, "fixture-cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-nodes", "-days", "2", "-subj", "/CN=Citaya Books Fixture/C=CL"], { stdio: "ignore" });
  chmodSync(keyPath, 0o600); chmodSync(certPath, 0o600);
  return { root, keyPath, certPath, key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
}

function assertKeyPair(material: Material): void {
  const fromPrivate = createPublicKey(createPrivateKey(material.key)).export({ format: "der", type: "spki" });
  const fromCert = new X509Certificate(material.cert).publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.from(fromPrivate).equals(Buffer.from(fromCert))) fail("certificado y llave fixture no hacen par");
}

function signingConfig(material: Material, id: string): RealXmlSigningConfig {
  return { tenantId: "citaya-books-fixture", mode: "certification", signatureTarget: id, privateKeyPath: material.keyPath, certificatePath: material.certPath, publicCertificatePath: material.certPath };
}

function signBook(unsignedXml: string, id: string, material: Material, options: FacturaBooksDryRunOptions): string {
  const envio = withNamespace(extractElement(unsignedXml, "EnvioLibro"));
  const referenceUri = options.overrides?.wrongReferenceUri ? `${id}-INCORRECTO` : id;
  const result = buildXmlDsigControlled({ referenceUri, signedXmlFragment: envio, mode: "certification" }, signingConfig(material, id));
  if (!result.verification?.ok) fail("firma XMLDSig fixture del libro no verifica");
  if (options.overrides?.signatureValueEmpty) return result.signatureXml.replace(/<SignatureValue>[\s\S]*?<\/SignatureValue>/, "<SignatureValue></SignatureValue>");
  if (options.overrides?.signatureValueFake) return result.signatureXml.replace(/<SignatureValue>[\s\S]*?<\/SignatureValue>/, "<SignatureValue>AA==<\/SignatureValue>");
  return result.signatureXml;
}

function applyModelOverrides(models: Models, overrides: FacturaBooksDryRunOptions["overrides"]): void {
  if (!overrides) return;
  if (overrides.wrongPeriod) models.sales.caratula.periodoTributario = "2026-06";
  if (overrides.swappedNotificationFolios) {
    (models.sales.caratula as { folioNotificacion: number }).folioNotificacion = 2;
    (models.purchase.caratula as { folioNotificacion: number }).folioNotificacion = 1;
  }
  if (overrides.wrongOperation) (models.sales.caratula as { tipoOperacion: string }).tipoOperacion = "COMPRA";
  if (overrides.missingSalesDetail) models.sales.detalle.pop();
  if (overrides.duplicatePurchaseDetail) models.purchase.detalle.push(models.purchase.detalle[0]);
}

function writeFinal(path: string, xml: string): void { writeFileSync(path, encodeIso88591Strict(xml)); chmodSync(path, 0o600); }

function verifyFinalSignature(xml: string, expectedId: string): void {
  const envio = withNamespace(extractElement(xml, "EnvioLibro"));
  if (extractFirst(envio, "TmstFirma") === "") fail("TmstFirma vacio");
  const id = envio.match(/\bID="([^"]+)"/)?.[1] ?? fail("ID EnvioLibro ausente");
  if (id !== expectedId) fail("ID EnvioLibro incorrecto");
  const signature = extractElement(xml, "Signature");
  const uri = signature.match(/<Reference URI="#([^"]+)"/)?.[1] ?? fail("Reference URI ausente");
  if (uri !== id) fail("Reference URI no coincide con ID");
  for (const token of ["2001/REC-xml-c14n-20010315", "xmldsig#rsa-sha1", "xmldsig#sha1", "RSAKeyValue", "Modulus", "Exponent", "X509Data", "X509Certificate"]) if (!signature.includes(token)) fail("perfil XMLDSig legacy incompleto");
  const signedInfoRaw = extractElement(signature, "SignedInfo");
  const signedInfo = signedInfoRaw.replace("<SignedInfo>", '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  const certText = extractFirst(signature, "X509Certificate").replace(/\s+/g, "");
  const cert = new X509Certificate(Buffer.from(certText, "base64"));
  const jwk = cert.publicKey.export({ format: "jwk" }) as { kty?: string; n?: string; e?: string };
  const modulus = extractFirst(signature, "Modulus").replace(/\s+/g, "");
  const exponent = extractFirst(signature, "Exponent").replace(/\s+/g, "");
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e || Buffer.from(modulus, "base64").toString("base64url") !== jwk.n || Buffer.from(exponent, "base64").toString("base64url") !== jwk.e) fail("RSAKeyValue no coincide con certificado final");
  const canonical = canonicalizeXmlControlled(envio);
  if (!canonical.ok) fail("canonicalizacion final del libro fallo");
  const verification = verifyXmlSignatureControlled({
    signedInfoXml: signedInfo,
    signatureValue: extractFirst(signature, "SignatureValue").trim(),
    certificatePem: cert.toString(),
    expectedDigestValue: extractFirst(signature, "DigestValue").trim(),
    canonicalizedReferenceXml: canonical.canonicalXml,
  });
  if (!verification.ok) fail("firma XMLDSig de archivo final no verifica");
}

function decodeFinal(path: string): { bytes: Buffer; xml: string } {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) || bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) fail("BOM detectado en libro final");
  const xml = bytes.toString("latin1");
  if (!xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')) fail("encoding final inconsistente");
  if (!encodeIso88591Strict(xml).equals(bytes)) fail("round-trip ISO-8859-1 fallo");
  return { bytes, xml };
}

function expectedEnvio(xml: string): string { return extractElement(xml, "EnvioLibro"); }

function validateFinalXsd(salesPath: string, purchasePath: string, repoRoot: string): void {
  const result = spawnSync("node", ["scripts/dte/books-xsd-check.mjs"], {
    cwd: repoRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, DTE_BOOKS_XSD_SALES_PATH: salesPath, DTE_BOOKS_XSD_PURCHASE_PATH: purchasePath },
  });
  if (result.status !== 0 || !/schemaIntegrity=ok/.test(result.stdout) || !/salesBook=valid/.test(result.stdout) || !/purchaseBook=valid/.test(result.stdout)) fail("XSD oficial final de libros invalido");
}

export function auditFacturaBooksFinalFiles(options: FacturaBooksDryRunOptions = {}): FacturaBooksDryRunResult {
  const env = options.env ?? process.env; const repoRoot = options.repoRoot ?? process.cwd();
  assertEnvironment(env, options.overrides);
  const outputDir = resolve(options.outputDir ?? env.DTE_FACTURA_BOOKS_DRY_RUN_OUTPUT_DIR ?? OUTPUT_DIR);
  if (!options.skipGeneration) generateFacturaBooks(options);
  const salesPath = join(outputDir, SALES_FILE); const purchasePath = join(outputDir, PURCHASE_FILE);
  const sales = decodeFinal(salesPath); const purchase = decodeFinal(purchasePath);
  const models = loadModels(env, repoRoot);
  const timestamp = options.timestamp ?? env.DTE_BOOKS_FIXTURE_TIMESTAMP ?? TIMESTAMP;
  const expectedSales = expectedEnvio(serializeSalesBookXml(models.sales, { timestamp }));
  const expectedPurchase = expectedEnvio(serializePurchaseBookXml(models.purchase, { timestamp }));
  if (expectedEnvio(sales.xml) !== expectedSales) fail("contenido final Libro de Ventas no coincide con modelo derivado");
  if (expectedEnvio(purchase.xml) !== expectedPurchase) fail("contenido final Libro de Compras no coincide con modelo derivado");
  verifyFinalSignature(sales.xml, SALES_ID); verifyFinalSignature(purchase.xml, PURCHASE_ID);
  validateFinalXsd(salesPath, purchasePath, repoRoot);
  const manifest = JSON.parse(readFileSync(join(outputDir, MANIFEST_FILE), "utf8")) as { files?: Array<{ file: string; sha256: string }> };
  if (manifest.files?.length !== 2 || manifest.files.some((item) => sha256(readFileSync(join(outputDir, item.file))) !== item.sha256)) fail("manifest SHA-256 final invalido");
  return { environment: "certification", fixtureMode: true, salesBook: "4959699", purchaseBook: "4959700", salesDetails: 8, purchaseDetails: 7, salesTotals: "valid", purchaseTotals: "valid", salesSignatureFinalBytes: "valid", purchaseSignatureFinalBytes: "valid", salesXsdFinalBytes: "valid", purchaseXsdFinalBytes: "valid", encoding: "ISO-8859-1", bom: "absent", schemaIntegrity: "ok", realCertificate: false, siiContacted: false, readyToDownloadCaf: false };
}

function generateFacturaBooks(options: FacturaBooksDryRunOptions): void {
  const env = options.env ?? process.env; const repoRoot = options.repoRoot ?? process.cwd();
  assertEnvironment(env, options.overrides);
  const models = loadModels(env, repoRoot); applyModelOverrides(models, options.overrides);
  const outputDir = resolve(options.outputDir ?? env.DTE_FACTURA_BOOKS_DRY_RUN_OUTPUT_DIR ?? OUTPUT_DIR);
  mkdirSync(outputDir, { recursive: true, mode: 0o700 }); chmodSync(outputDir, 0o700);
  const signingMaterial = createMaterial("citaya-pre-caf-10-books");
  const certificateMaterial = options.overrides?.mismatchedCertificateKey ? createMaterial("citaya-pre-caf-10-other") : signingMaterial;
  try {
    assertKeyPair({ ...signingMaterial, cert: certificateMaterial.cert, certPath: certificateMaterial.certPath });
    const timestamp = options.timestamp ?? env.DTE_BOOKS_FIXTURE_TIMESTAMP ?? TIMESTAMP;
    const salesUnsigned = serializeSalesBookXml(models.sales, { timestamp });
    const purchaseUnsigned = serializePurchaseBookXml(models.purchase, { timestamp });
    const salesSignature = signBook(salesUnsigned, SALES_ID, signingMaterial, options);
    const purchaseSignature = signBook(purchaseUnsigned, PURCHASE_ID, signingMaterial, options);
    const salesXml = serializeSalesBookXml(models.sales, { timestamp, signatureXml: salesSignature });
    const purchaseXml = serializePurchaseBookXml(models.purchase, { timestamp, signatureXml: purchaseSignature });
    const salesPath = join(outputDir, SALES_FILE); const purchasePath = join(outputDir, PURCHASE_FILE);
    writeFinal(salesPath, salesXml); writeFinal(purchasePath, purchaseXml);
    const manifest = { fixtureMode: true, legalValidity: "SIN_VALIDEZ_TRIBUTARIA", files: [salesPath, purchasePath].map((path) => ({ file: path.split("/").pop(), sha256: sha256(readFileSync(path)) })) };
    writeFileSync(join(outputDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });
  } finally {
    rmSync(signingMaterial.root, { recursive: true, force: true });
    if (certificateMaterial.root !== signingMaterial.root) rmSync(certificateMaterial.root, { recursive: true, force: true });
  }
}

export function runFacturaBooksDryRun(options: FacturaBooksDryRunOptions = {}): FacturaBooksDryRunResult { return auditFacturaBooksFinalFiles(options); }
export function formatFacturaBooksDryRunResult(result: FacturaBooksDryRunResult): string { return Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n"); }
