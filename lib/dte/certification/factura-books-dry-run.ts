import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

import { canonicalizeXmlControlled, buildXmlDsigControlled, signXmlInFinalContextControlled, verifyXmlSignatureControlled } from "../signing/sign-xml.real";
import { requestSeed, requestToken, signSeed, SII_CERTIFICATION_SEED_URL, SII_CERTIFICATION_TOKEN_URL } from "../sii/sii-auth";
import type { SiiCertificationConfig } from "../sii/sii-types";
import type { RealXmlSigningConfig } from "../types";
import { buildFacturaCertificationDocuments, type FacturaCertificationCaseId } from "./factura-electronica-set";
import { classifyUploadResponse, SET_SUBMIT_URL, validateCertificationReissueManifestLineage } from "./factura-certification-set-submit";
import { encodeIso88591Strict } from "./factura-set-dry-run";
import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";
import { validatePreCafExternalData } from "./pre-caf-external-contract";
import { buildSalesBookModelFromDocuments, serializeSalesBookXml } from "./sales-book";
import { buildPurchaseBookModel, PURCHASE_BOOK_SET_4959700, serializePurchaseBookXml } from "./purchase-book";

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

function assertFixtureKeyPair(material: Material): void {
  const fromPrivate = createPublicKey(createPrivateKey(material.key)).export({ format: "der", type: "spki" });
  const fromCert = new X509Certificate(material.cert).publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.from(fromPrivate).equals(Buffer.from(fromCert))) fail("certificado y llave fixture no hacen par");
}

function fixtureSigningConfig(material: Material, id: string): RealXmlSigningConfig {
  return { tenantId: "citaya-books-fixture", mode: "certification", signatureTarget: id, privateKeyPath: material.keyPath, certificatePath: material.certPath, publicCertificatePath: material.certPath };
}

function signBook(unsignedXml: string, id: string, material: Material, options: FacturaBooksDryRunOptions): string {
  const envio = withNamespace(extractElement(unsignedXml, "EnvioLibro"));
  const referenceUri = options.overrides?.wrongReferenceUri ? `${id}-INCORRECTO` : id;
  const result = buildXmlDsigControlled({ referenceUri, signedXmlFragment: envio, mode: "certification" }, fixtureSigningConfig(material, id));
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
    assertFixtureKeyPair({ ...signingMaterial, cert: certificateMaterial.cert, certPath: certificateMaterial.certPath });
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

const REAL_SALES_ROOT = "/home/verf/secure/dte-lab";
const REAL_SALES_OUTPUT_DIR = `${REAL_SALES_ROOT}/sales-book-4959699/attempt-001`;
const REAL_SALES_XML = "LibroVentas-4959699-CERTIFICATION.xml";
const REAL_SALES_MANIFEST = "manifest-4959699-VENTAS.json";
const REAL_SALES_REGISTRY = "registry-4959699-VENTAS.jsonl";
const ACCEPTED_SET_DIR = `${REAL_SALES_ROOT}/set-4959698-reissue-001`;
const ACCEPTED_SET_MANIFEST = `${ACCEPTED_SET_DIR}/manifest-4959698-CERTIFICATION.json`;
const ACCEPTED_SET_REGISTRY = `${REAL_SALES_ROOT}/submit-registry/875e311358155109761133688bdbbec1341a038cb0ebdd17290b3e711d4912a0.json`;
const ACCEPTED_SET_ENVELOPE_SHA256 = "875e311358155109761133688bdbbec1341a038cb0ebdd17290b3e711d4912a0";
const ACCEPTED_SET_TRACK_ID = "0253277434";
const REAL_INPUT = `${REAL_SALES_ROOT}/factura-pre-caf-input.json`;
const REAL_CERT = `${REAL_SALES_ROOT}/certs/certificado-digital.pem`;
const REAL_KEY = `${REAL_SALES_ROOT}/private/certificado-private-key.pem`;
const REAL_SALES_ID = "LibroVentas-4959699";

type RealSalesBookPublicResult = {
  generationPrepared: boolean;
  setNumber: "4959699";
  detailsCount: number;
  totalsMatch: boolean;
  acceptedSetReferences: boolean;
  xsdValid: boolean;
  xmlsec1Valid: boolean;
  encoding: "ISO-8859-1";
  preflightStatus: "PASS";
  submitExecuted: boolean;
  receptionStatus: string;
  submitted: boolean;
  trackId: string;
  siiContacted: boolean;
  statusQueried: false;
};

type AcceptedSalesSource = {
  model: ReturnType<typeof buildSalesBookModelFromDocuments>;
  sourceManifestSha256: string;
  sourceEnvelopeSha256: string;
  issuerRut: string;
  senderRut: string;
};

type TreeSnapshot = { digest: string; files: Array<{ path: string; sha256: string }> };

function realFail(field: string): never { throw new Error(`real_sales_book_preflight:${field}`); }
function shaFile(path: string): string { return sha256(readFileSync(path)); }
function relativeToRepo(path: string, repoRoot: string): boolean {
  const rel = relative(resolve(repoRoot), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}
function xmlText(xml: string, name: string): string {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<\\/${name}>`))?.[1]?.trim() ?? realFail(`accepted_dte_${name}`);
}
function optionalXmlNumber(xml: string, name: string): number {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<\\/${name}>`));
  return match ? Number(match[1].trim()) : 0;
}
function safeRutParts(value: string): { rut: string; dv: string } {
  const match = value.replace(/\./g, "").toUpperCase().match(/^(\d{1,8})-([0-9K])$/);
  if (!match) realFail("rut");
  return { rut: match[1], dv: match[2] };
}
function santiagoTimestamp(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date()).replace(" ", "T");
}
function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path).sort()) {
      const child = join(path, entry);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) realFail("secure_symlink");
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile()) output.push(child);
    }
  };
  walk(root);
  return output;
}
function snapshotPrevious(kind: "artifacts" | "registries", excludedOutputDir: string = REAL_SALES_OUTPUT_DIR): TreeSnapshot {
  const registryRoots = [join(REAL_SALES_ROOT, "submissions"), join(REAL_SALES_ROOT, "submit-registry"), join(REAL_SALES_ROOT, "ledger")];
  const files = kind === "registries"
    ? registryRoots.flatMap(listFiles)
    : listFiles(REAL_SALES_ROOT).filter((path) =>
      !path.startsWith(`${excludedOutputDir}${sep}`) &&
      !registryRoots.some((root) => path.startsWith(`${root}${sep}`)));
  const entries = files.sort().map((path) => ({ path, sha256: shaFile(path) }));
  return { digest: sha256(Buffer.from(entries.map((entry) => `${entry.path}\0${entry.sha256}`).join("\n"))), files: entries };
}
function snapshotStillMatches(snapshot: TreeSnapshot): boolean {
  return snapshot.files.every((entry) => existsSync(entry.path) && shaFile(entry.path) === entry.sha256);
}
function assertConfiguredKeyPair(certificatePath: string, privateKeyPath: string): void {
  const privatePem = readFileSync(privateKeyPath, "utf8");
  const certPem = readFileSync(certificatePath, "utf8");
  const privatePublic = createPublicKey(createPrivateKey(privatePem)).export({ format: "der", type: "spki" });
  const certPublic = new X509Certificate(certPem).publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.from(privatePublic).equals(Buffer.from(certPublic))) realFail("certificateKeyMatch");
}
function assertKeyPair(): void { assertConfiguredKeyPair(REAL_CERT, REAL_KEY); }
function signingConfig(id: string): RealXmlSigningConfig {
  return { tenantId: "citaya-sales-book-4959699", mode: "certification", signatureTarget: id, privateKeyPath: REAL_KEY, certificatePath: REAL_CERT, publicCertificatePath: REAL_CERT };
}
function configuredSigningConfig(id: string, certificatePath: string, privateKeyPath: string): RealXmlSigningConfig {
  return { tenantId: id, mode: "certification", signatureTarget: id, privateKeyPath, certificatePath, publicCertificatePath: certificatePath };
}
function loadAcceptedSalesSource(repoRoot: string): AcceptedSalesSource {
  const manifestBytes = readFileSync(ACCEPTED_SET_MANIFEST);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
  if (!validateCertificationReissueManifestLineage(manifest)) realFail("accepted_manifest_lineage");
  if (manifest.envelopeSha256 !== ACCEPTED_SET_ENVELOPE_SHA256) realFail("accepted_envelope_sha256");
  const registry = JSON.parse(readFileSync(ACCEPTED_SET_REGISTRY, "utf8")) as Record<string, unknown>;
  if (registry.state !== "submitted" || registry.trackId !== ACCEPTED_SET_TRACK_ID || registry.envelopeSha256 !== ACCEPTED_SET_ENVELOPE_SHA256) realFail("accepted_registry");
  const manifestFiles = new Map((manifest.files as Array<Record<string, unknown>>).map((entry) => [String(entry.file), String(entry.sha256)]));
  const accepted = Array.from({ length: 8 }, (_, index) => {
    const caseId = `4959698-${index + 1}` as FacturaCertificationCaseId;
    const file = `${caseId}-DTE-CERTIFICATION.xml`;
    const path = join(ACCEPTED_SET_DIR, file);
    if (manifestFiles.get(file) !== shaFile(path)) realFail("accepted_dte_hash");
    const xml = readFileSync(path, "latin1");
    return {
      caseId, type: Number(xmlText(xml, "TipoDTE")), folio: Number(xmlText(xml, "Folio")),
      date: xmlText(xml, "FchEmis"), recipientRut: xmlText(xml, "RUTRecep"),
      recipientName: xmlText(xml, "RznSocRecep"), issuerRut: xmlText(xml, "RUTEmisor"),
      mntExe: optionalXmlNumber(xml, "MntExe"), mntNeto: optionalXmlNumber(xml, "MntNeto"),
      mntIVA: optionalXmlNumber(xml, "IVA"), mntTotal: Number(xmlText(xml, "MntTotal")),
    };
  });
  const expectedRefs = [[33, 5], [33, 6], [33, 7], [33, 8], [61, 4], [61, 5], [61, 6], [56, 2]];
  if (!accepted.every((item, index) => item.type === expectedRefs[index][0] && item.folio === expectedRefs[index][1])) realFail("accepted_folio_references");
  const loaded = loadFacturaPreCafInputFromPath({ inputPath: REAL_INPUT, repoRoot, env: { NODE_ENV: process.env.NODE_ENV, DTE_FACTURA_PRE_CAF_ISSUE_DATE: accepted[0].date } });
  if (!loaded.ok || !validatePreCafExternalData(loaded.input).ok) realFail("external_contract");
  const issuer = loaded.input.issuer ?? realFail("issuer");
  if (String(issuer.periodoTributario) !== "2026-07" || accepted.some((item) => item.issuerRut !== String(issuer.rutEmisor))) realFail("accepted_period_or_issuer");
  const documents = buildFacturaCertificationDocuments({
    issueDate: accepted[0].date, taxPeriod: String(issuer.periodoTributario),
    textCorrection: { previousBusinessActivity: loaded.input.textCorrection?.giroAnterior, correctedBusinessActivity: loaded.input.textCorrection?.giroCorregido },
  });
  const details = Object.fromEntries(accepted.map((item) => [item.caseId, { folio: item.folio, recipientRut: item.recipientRut, recipientName: item.recipientName }]));
  const model = buildSalesBookModelFromDocuments({
    externalData: { rutEmisorLibro: String(issuer.rutEmisor), rutEnvia: String(issuer.rutEnvia), fchResol: String(issuer.fechaResolucion), nroResol: Number(issuer.numeroResolucion) },
    details, documents,
  });
  const totalsMatch = model.detalle.every((detail, index) => {
    const source = accepted[index];
    return detail.caseId === source.caseId && detail.tpoDoc === source.type && detail.folio === source.folio &&
      detail.fecha === source.date && detail.mntExe === source.mntExe && detail.mntNeto === source.mntNeto &&
      detail.mntIVA === source.mntIVA && detail.mntTotal === source.mntTotal;
  });
  if (!totalsMatch || model.detalle.length !== 8 || model.caratula.periodoTributario !== "2026-07" ||
      model.caratula.tipoOperacion !== "VENTA" || model.caratula.tipoLibro !== "ESPECIAL" ||
      model.caratula.tipoEnvio !== "TOTAL" || model.caratula.folioNotificacion !== 1) realFail("sales_model");
  return {
    model, sourceManifestSha256: sha256(manifestBytes), sourceEnvelopeSha256: ACCEPTED_SET_ENVELOPE_SHA256,
    issuerRut: String(issuer.rutEmisor), senderRut: String(issuer.rutEnvia),
  };
}
function validateRealBookFile(path: string, repoRoot: string, referenceId: string = REAL_SALES_ID, certificatePath: string = REAL_CERT): void {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) || bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) realFail("bom");
  const xml = bytes.toString("latin1");
  if (!xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>') || !encodeIso88591Strict(xml).equals(bytes)) realFail("encoding");
  if (spawnSync("xmllint", ["--noout", path], { stdio: "ignore" }).status !== 0) realFail("xmlSyntax");
  const xsd = spawnSync("node", ["scripts/dte/books-xsd-check.mjs"], {
    cwd: repoRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, DTE_BOOKS_XSD_SALES_PATH: path, DTE_BOOKS_XSD_PURCHASE_PATH: path },
  });
  if (xsd.status !== 0 || !/schemaIntegrity=ok/.test(xsd.stdout) || !/salesBook=valid/.test(xsd.stdout)) realFail("libroCvXsd");
  const verify = spawnSync("xmlsec1", [
    "--verify", "--id-attr:ID", "EnvioLibro", "--pubkey-cert-pem", certificatePath,
    "--node-xpath", `//*[local-name()='Signature'][.//*[local-name()='Reference' and @URI='#${referenceId}']]`, path,
  ], { stdio: "ignore" });
  if (verify.status !== 0) realFail("xmlsec1SignatureValid");
}
function publicPreflightResult(): RealSalesBookPublicResult {
  return {
    generationPrepared: true, setNumber: "4959699", detailsCount: 8, totalsMatch: true,
    acceptedSetReferences: true, xsdValid: true, xmlsec1Valid: true, encoding: "ISO-8859-1",
    preflightStatus: "PASS", submitExecuted: false, receptionStatus: "NOT_SUBMITTED",
    submitted: false, trackId: "", siiContacted: false, statusQueried: false,
  };
}
function appendRegistry(event: Record<string, unknown>): void {
  const path = join(REAL_SALES_OUTPUT_DIR, REAL_SALES_REGISTRY);
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}
function readManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REAL_SALES_OUTPUT_DIR, REAL_SALES_MANIFEST), "utf8")) as Record<string, unknown>;
}
function auditPreparedRealSalesBook(repoRoot: string): AcceptedSalesSource {
  const source = loadAcceptedSalesSource(repoRoot);
  const manifest = readManifest();
  const xmlPath = join(REAL_SALES_OUTPUT_DIR, REAL_SALES_XML);
  if (manifest.setNumber !== "4959699" || manifest.libroType !== "VENTAS" || manifest.detailsCount !== 8 ||
      manifest.totalsMatch !== true || manifest.referencesMatchAcceptedSet !== true ||
      manifest.sourceEnvelopeSha256 !== source.sourceEnvelopeSha256 || manifest.sourceManifestSha256 !== source.sourceManifestSha256 ||
      manifest.xmlSha256 !== shaFile(xmlPath) || manifest.signatureAuthority !== "xmlsec1" ||
      manifest.internalVerifier !== "non_authoritative" || manifest.encoding !== "ISO-8859-1" || manifest.bom !== "absent") realFail("prepared_manifest");
  if (snapshotPrevious("artifacts").digest !== manifest.previousArtifactSnapshotSha256 ||
      snapshotPrevious("registries").digest !== manifest.previousRegistrySnapshotSha256) realFail("previous_state_changed");
  assertKeyPair();
  validateRealBookFile(xmlPath, repoRoot);
  const xml = readFileSync(xmlPath, "latin1");
  const envio = extractElement(xml, "EnvioLibro");
  const expected = extractElement(serializeSalesBookXml(source.model, { id: REAL_SALES_ID, timestamp: String(manifest.signatureTimestamp) }), "EnvioLibro");
  if (envio !== expected) realFail("prepared_content");
  return source;
}

export function prepareRealSalesBook(repoRoot: string = process.cwd()): RealSalesBookPublicResult {
  if (existsSync(REAL_SALES_OUTPUT_DIR)) realFail("attempt_already_exists");
  if (!isAbsolute(REAL_SALES_OUTPUT_DIR) || relativeToRepo(REAL_SALES_OUTPUT_DIR, repoRoot)) realFail("outputOutsideRepo");
  for (const path of [REAL_INPUT, REAL_CERT, REAL_KEY, ACCEPTED_SET_MANIFEST, ACCEPTED_SET_REGISTRY]) if (!existsSync(path)) realFail("required_external_file");
  const previousArtifacts = snapshotPrevious("artifacts");
  const previousRegistries = snapshotPrevious("registries");
  const source = loadAcceptedSalesSource(repoRoot);
  assertKeyPair();
  const timestamp = santiagoTimestamp();
  const unsignedXml = serializeSalesBookXml(source.model, { id: REAL_SALES_ID, timestamp });
  const signed = signXmlInFinalContextControlled({
    xml: unsignedXml, referenceId: REAL_SALES_ID,
    insertAfterXPath: `//*[local-name()='EnvioLibro' and @ID='${REAL_SALES_ID}']`,
  }, signingConfig(REAL_SALES_ID));
  const bytes = encodeIso88591Strict(signed.signedXml);
  const tempDir = mkdtempSync(join(tmpdir(), "citaya-sales-book-4959699-"));
  const tempPath = join(tempDir, REAL_SALES_XML);
  try {
    writeFileSync(tempPath, bytes, { flag: "wx", mode: 0o600 });
    validateRealBookFile(tempPath, repoRoot);
    if (!snapshotStillMatches(previousArtifacts) || !snapshotStillMatches(previousRegistries)) realFail("previous_state_changed");
    mkdirSync(REAL_SALES_OUTPUT_DIR, { recursive: true, mode: 0o700 });
    chmodSync(REAL_SALES_OUTPUT_DIR, 0o700);
    const xmlPath = join(REAL_SALES_OUTPUT_DIR, REAL_SALES_XML);
    writeFileSync(xmlPath, bytes, { flag: "wx", mode: 0o600 });
    chmodSync(xmlPath, 0o600);
    validateRealBookFile(xmlPath, repoRoot);
    if (!snapshotStillMatches(previousArtifacts) || !snapshotStillMatches(previousRegistries)) realFail("previous_state_changed");
    const manifest = {
      schemaVersion: 1, artifactKind: "certification_sales_book", setNumber: "4959699", libroType: "VENTAS",
      sourceSetNumber: "4959698", sourceEnvelopeSha256: source.sourceEnvelopeSha256,
      sourceManifestSha256: source.sourceManifestSha256, acceptedTrackIdFingerprint: sha256(Buffer.from(ACCEPTED_SET_TRACK_ID)).slice(0, 16),
      acceptedFolios: { "33": [5, 6, 7, 8], "61": [4, 5, 6], "56": [2] },
      detailsCount: 8, totalsMatch: true, referencesMatchAcceptedSet: true,
      periodoTributario: "2026-07", tipoOperacion: "VENTA", tipoLibro: "ESPECIAL", tipoEnvio: "TOTAL", folioNotificacion: 1,
      xmlSyntax: "valid", libroCvXsd: "valid", xmlsec1SignatureValid: true, certificateKeyMatch: true,
      signatureAuthority: "xmlsec1", internalVerifier: "non_authoritative", encoding: "ISO-8859-1", bom: "absent",
      outputOutsideRepo: true, previousArtifactSnapshotSha256: previousArtifacts.digest,
      previousRegistrySnapshotSha256: previousRegistries.digest, previousArtifactsUnchanged: true, previousRegistriesUnchanged: true,
      signatureTimestamp: timestamp, xmlFile: REAL_SALES_XML, xmlSha256: sha256(bytes), generatedAt: new Date().toISOString(),
    };
    const manifestPath = join(REAL_SALES_OUTPUT_DIR, REAL_SALES_MANIFEST);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
    chmodSync(manifestPath, 0o600);
    const registryPath = join(REAL_SALES_OUTPUT_DIR, REAL_SALES_REGISTRY);
    writeFileSync(registryPath, `${JSON.stringify({ at: new Date().toISOString(), stage: "preflight_passed", setNumber: "4959699", libroType: "VENTAS", xmlSha256: manifest.xmlSha256, manifestSha256: shaFile(manifestPath), statusQueryEnabled: false })}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(registryPath, 0o600);
    auditPreparedRealSalesBook(repoRoot);
    return publicPreflightResult();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function submitPreparedRealSalesBook(repoRoot: string = process.cwd(), fetchImpl: typeof fetch = fetch): Promise<RealSalesBookPublicResult> {
  const source = auditPreparedRealSalesBook(repoRoot);
  const registryPath = join(REAL_SALES_OUTPUT_DIR, REAL_SALES_REGISTRY);
  const events = readFileSync(registryPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  if (events.length !== 1 || events[0].stage !== "preflight_passed" || events.some((event) => event.stage === "upload_started")) realFail("submit_already_attempted");
  const config: SiiCertificationConfig = {
    environment: "certification", seedUrl: SII_CERTIFICATION_SEED_URL, tokenUrl: SII_CERTIFICATION_TOKEN_URL,
    submitUrl: SET_SUBMIT_URL, statusUrl: "", certPath: REAL_CERT, privateKeyPath: REAL_KEY,
    cafPath: null, cafPrivateKeyPath: null, rutEmpresa: source.issuerRut, rutUsuario: source.senderRut,
    timeoutMs: 30_000, enableSubmit: true,
  };
  let siiContacted = false;
  let submitExecuted = false;
  let tokenFingerprint: string | null = null;
  try {
    appendRegistry({ stage: "seed_started" });
    const seed = await requestSeed(config, { fetchImpl });
    siiContacted = true;
    if (!seed.seed) realFail("seed_response");
    appendRegistry({ stage: "seed_completed" });
    const signedSeed = signSeed(seed.seed, config);
    const token = await requestToken(signedSeed.signedSeed ?? "", config, { fetchImpl });
    if (!token.token) realFail("token_response");
    tokenFingerprint = sha256(Buffer.from(token.token)).slice(0, 16);
    appendRegistry({ stage: "token_completed", tokenFingerprint });
    const sender = safeRutParts(source.senderRut);
    const company = safeRutParts(source.issuerRut);
    const xmlPath = join(REAL_SALES_OUTPUT_DIR, REAL_SALES_XML);
    const bytes = readFileSync(xmlPath);
    const form = new FormData();
    form.set("rutSender", sender.rut); form.set("dvSender", sender.dv);
    form.set("rutCompany", company.rut); form.set("dvCompany", company.dv);
    form.set("archivo", new Blob([Uint8Array.from(bytes)], { type: "text/xml" }), REAL_SALES_XML);
    appendRegistry({ stage: "upload_started", endpointOrigin: "https://maullin.sii.cl", endpointPath: "/cgi_dte/UPL/DTEUpload", multipartBuilt: true, redirectPolicy: "manual" });
    submitExecuted = true;
    const response = await fetchImpl(SET_SUBMIT_URL, {
      method: "POST",
      headers: { "user-agent": "PROG 1.0", accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8", "accept-language": "es-cl", referer: "https://maullin.sii.cl/", "cache-control": "no-cache", cookie: `TOKEN=${token.token}` },
      body: form, redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs),
    });
    siiContacted = true;
    const raw = await response.text();
    const classification = classifyUploadResponse(raw);
    const submitted = response.ok && classification.kind === "accepted" && Boolean(classification.trackId);
    appendRegistry({
      stage: submitted ? "submitted" : classification.kind === "rejected" ? "rejected" : "ambiguous",
      httpStatus: response.status, responseContentType: response.headers.get("content-type"),
      responseBytes: Buffer.byteLength(raw, "utf8"), responseSha256: sha256(Buffer.from(raw)),
      receptionStatus: classification.status ?? "invalid", semanticCategory: classification.semanticCategory,
      trackId: submitted ? classification.trackId : undefined, tokenFingerprint, submitted, statusQueried: false,
    });
    return {
      ...publicPreflightResult(), submitExecuted: true,
      receptionStatus: classification.status ?? "invalid", submitted,
      trackId: submitted ? String(classification.trackId) : "", siiContacted, statusQueried: false,
    };
  } catch (error) {
    appendRegistry({ stage: submitExecuted ? "ambiguous" : "auth_failed", tokenFingerprint, submitExecuted, siiContacted, statusQueried: false });
    throw error;
  }
}

export function formatRealSalesBookResult(result: RealSalesBookPublicResult): string {
  return Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n");
}

const CORRECTION_OUTPUT_DIR = `${REAL_SALES_ROOT}/sales-book-correction-001`;
const CORRECTION_XML = "LibroVentas-4959699-CORRECTION-001.xml";
const CORRECTION_MANIFEST = "manifest-4959699-VENTAS-correction-001.json";
const CORRECTION_REGISTRY = "registry-4959699-VENTAS-correction-001.jsonl";
const CORRECTION_NUMBER = 1;
const CORRECTION_REASON = "SCH-STATUS-7-MISSING-SCHEMA-LOCATION";
const REJECTED_ARTIFACT_SHA256 = "e974c1db3507495f457dae9eba579543262032b89bf3307ee0f4b338992f3ac1";
const REJECTED_RESPONSE_SHA256 = "09d0ed1b63dea6922fffb4bede7d9c9f6e8e3b8a128b501f547a11c263eef0e6";
const SCHEMA_LOCATION = "http://www.sii.cl/SiiDte LibroCV_v10.xsd";

type CorrectionResult = {
  correctionPrepared: boolean;
  schemaLocationExact: boolean;
  xsdValid: boolean;
  xmlsec1Valid: boolean;
  previousArtifactUnchanged: boolean;
  preflightStatus: "PASS";
  submitExecuted: boolean;
  receptionStatus: string;
  safeGlosa: string;
  safeErrorCodes: string;
  submitted: boolean;
  trackId: string;
  siiContacted: boolean;
  statusQueried: false;
};

type SafeReception = {
  status: string | null;
  glosa: string;
  errorCodes: string[];
  errorMessages: string[];
  line: string | null;
  column: string | null;
};

function correctionPublicResult(): CorrectionResult {
  return {
    correctionPrepared: true, schemaLocationExact: true, xsdValid: true, xmlsec1Valid: true,
    previousArtifactUnchanged: true, preflightStatus: "PASS", submitExecuted: false,
    receptionStatus: "NOT_SUBMITTED", safeGlosa: "", safeErrorCodes: "",
    submitted: false, trackId: "", siiContacted: false, statusQueried: false,
  };
}
function correctionPath(name: string): string { return join(CORRECTION_OUTPUT_DIR, name); }
function rejectedPath(name: string): string { return join(REAL_SALES_OUTPUT_DIR, name); }
function correctionLinkage(): Record<string, unknown> {
  return {
    correctionNumber: CORRECTION_NUMBER, correctionReasonCode: CORRECTION_REASON,
    correctionOfArtifactSha256: REJECTED_ARTIFACT_SHA256,
    correctionOfResponseSha256: REJECTED_RESPONSE_SHA256,
  };
}
function appendCorrectionRegistry(event: Record<string, unknown>): void {
  const path = correctionPath(CORRECTION_REGISTRY);
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...correctionLinkage(), ...event })}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}
function rejectedEvidence(): { artifactSha256: string; manifestSha256: string; registrySha256: string } {
  const artifactPath = rejectedPath(REAL_SALES_XML);
  const manifestPath = rejectedPath(REAL_SALES_MANIFEST);
  const registryPath = rejectedPath(REAL_SALES_REGISTRY);
  if (shaFile(artifactPath) !== REJECTED_ARTIFACT_SHA256) realFail("correction_rejected_artifact");
  const rejectedManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  if (rejectedManifest.xmlSha256 !== REJECTED_ARTIFACT_SHA256) realFail("correction_rejected_manifest");
  const events = readFileSync(registryPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const terminal = events.at(-1);
  if (events.filter((event) => event.stage === "upload_started").length !== 1 || terminal?.stage !== "rejected" ||
      terminal.receptionStatus !== "7" || terminal.responseSha256 !== REJECTED_RESPONSE_SHA256 ||
      Number(terminal.responseBytes) !== 311 || Boolean(terminal.trackId)) realFail("correction_rejected_registry");
  return { artifactSha256: shaFile(artifactPath), manifestSha256: shaFile(manifestPath), registrySha256: shaFile(registryPath) };
}
function assertCorrectionHeader(xml: string): void {
  const root = xml.match(/<LibroCompraVenta\b([^>]*)>/)?.[1] ?? realFail("correction_root");
  const attribute = (name: string) => root.match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`))?.[1] ?? null;
  if (attribute("xmlns") !== NS || attribute("version") !== "1.0" ||
      attribute("xmlns:xsi") !== "http://www.w3.org/2001/XMLSchema-instance" ||
      attribute("xsi:schemaLocation") !== SCHEMA_LOCATION ||
      attribute("xsi:noNamespaceSchemaLocation") !== null) realFail("correction_schema_location");
}
function assertSameTaxInformation(rejectedXml: string, correctedXml: string): void {
  for (const tag of ["Caratula", "ResumenPeriodo"]) {
    if (extractElement(rejectedXml, tag) !== extractElement(correctedXml, tag)) realFail(`correction_tax_${tag.toLowerCase()}`);
  }
  const extractAll = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g"))].map((match) => match[0]);
  const rejectedDetails = extractAll(rejectedXml, "Detalle");
  const correctedDetails = extractAll(correctedXml, "Detalle");
  if (rejectedDetails.length !== 8 || JSON.stringify(rejectedDetails) !== JSON.stringify(correctedDetails)) realFail("correction_tax_details");
}
function safeReceptionText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\b\d{1,3}(?:\.\d{3}){1,2}-[0-9K]\b|\b\d{7,8}-[0-9K]\b/gi, "[RUT]").replace(/\s+/g, " ").trim().slice(0, 500);
}
function parseSafeReception(raw: string): SafeReception {
  const document = new DOMParser().parseFromString(raw, "application/xml");
  const elements = [document.documentElement, ...Array.from(document.documentElement?.getElementsByTagName("*") ?? [])];
  const local = (element: XmlElement) => String(element.localName || element.nodeName).replace(/^.*:/, "").toUpperCase();
  const first = (names: string[]) => {
    const element = elements.find((item) => item && names.includes(local(item as XmlElement)));
    return element?.textContent?.trim() ?? null;
  };
  const errorElements = elements.filter((item) => item && ["ERROR", "ERRORDETAIL", "DETALLEERROR"].includes(local(item as XmlElement))) as XmlElement[];
  const errorMessages = [...new Set(errorElements.map((item) => safeReceptionText(item.textContent)).filter(Boolean))];
  const errorCodes = [...new Set(errorElements.flatMap((item) => {
    const attribute = item.getAttribute("code") ?? item.getAttribute("codigo") ?? "";
    const textCode = safeReceptionText(item.textContent).match(/^(?:ERROR\s*)?([A-Z0-9_.-]{1,32})(?:\s*[:;-]|$)/i)?.[1] ?? "";
    return [attribute, textCode].map((value) => safeReceptionText(value)).filter(Boolean);
  }))];
  return {
    status: first(["STATUS"]), glosa: safeReceptionText(first(["GLOSA", "MESSAGE", "MENSAJE"])),
    errorCodes, errorMessages, line: first(["LINE", "LINEA"]), column: first(["COLUMN", "COLUMNA"]),
  };
}
async function assertCorrectionMultipart(bytes: Buffer): Promise<void> {
  const blob = new Blob([Uint8Array.from(bytes)], { type: "text/xml" });
  if (blob.type !== "text/xml" || !Buffer.from(await blob.arrayBuffer()).equals(bytes) || !CORRECTION_XML.endsWith(".xml")) realFail("correction_multipart");
}
async function auditPreparedCorrection(repoRoot: string): Promise<AcceptedSalesSource> {
  const rejected = rejectedEvidence();
  const source = loadAcceptedSalesSource(repoRoot);
  const manifest = JSON.parse(readFileSync(correctionPath(CORRECTION_MANIFEST), "utf8")) as Record<string, unknown>;
  const xmlPath = correctionPath(CORRECTION_XML);
  if (manifest.correctionNumber !== CORRECTION_NUMBER || manifest.correctionReasonCode !== CORRECTION_REASON ||
      manifest.correctionOfArtifactSha256 !== rejected.artifactSha256 ||
      manifest.correctionOfResponseSha256 !== REJECTED_RESPONSE_SHA256 ||
      manifest.correctionOfManifestSha256 !== rejected.manifestSha256 ||
      manifest.correctionOfRegistrySha256 !== rejected.registrySha256 ||
      manifest.xmlSha256 !== shaFile(xmlPath) || manifest.detailsCount !== 8 || manifest.totalsMatch !== true ||
      manifest.referencesMatchAcceptedSet !== true || manifest.namespaceExact !== true ||
      manifest.xsiPhysicallyDeclared !== true || manifest.schemaLocationExact !== true ||
      manifest.multipartBytesEqualArtifact !== true || manifest.multipartContentType !== "text/xml") realFail("correction_manifest");
  if (snapshotPrevious("artifacts", CORRECTION_OUTPUT_DIR).digest !== manifest.previousArtifactSnapshotSha256 ||
      snapshotPrevious("registries", CORRECTION_OUTPUT_DIR).digest !== manifest.previousRegistrySnapshotSha256) realFail("correction_previous_state");
  assertKeyPair();
  validateRealBookFile(xmlPath, repoRoot);
  const bytes = readFileSync(xmlPath);
  const xml = bytes.toString("latin1");
  assertCorrectionHeader(xml);
  assertSameTaxInformation(readFileSync(rejectedPath(REAL_SALES_XML), "latin1"), xml);
  await assertCorrectionMultipart(bytes);
  rejectedEvidence();
  return source;
}

export async function prepareRealSalesBookCorrection(repoRoot: string = process.cwd()): Promise<CorrectionResult> {
  if (existsSync(CORRECTION_OUTPUT_DIR)) realFail("correction_already_exists");
  if (!isAbsolute(CORRECTION_OUTPUT_DIR) || relativeToRepo(CORRECTION_OUTPUT_DIR, repoRoot)) realFail("correction_output");
  const rejected = rejectedEvidence();
  const previousArtifacts = snapshotPrevious("artifacts", CORRECTION_OUTPUT_DIR);
  const previousRegistries = snapshotPrevious("registries", CORRECTION_OUTPUT_DIR);
  const source = loadAcceptedSalesSource(repoRoot);
  assertKeyPair();
  const timestamp = santiagoTimestamp();
  const unsignedXml = serializeSalesBookXml(source.model, { id: REAL_SALES_ID, includeSchemaLocation: true, timestamp });
  assertCorrectionHeader(unsignedXml);
  assertSameTaxInformation(readFileSync(rejectedPath(REAL_SALES_XML), "latin1"), unsignedXml);
  const signed = signXmlInFinalContextControlled({
    xml: unsignedXml, referenceId: REAL_SALES_ID,
    insertAfterXPath: `//*[local-name()='EnvioLibro' and @ID='${REAL_SALES_ID}']`,
  }, signingConfig(REAL_SALES_ID));
  const bytes = encodeIso88591Strict(signed.signedXml);
  const tempDir = mkdtempSync(join(tmpdir(), "citaya-sales-book-correction-001-"));
  const tempPath = join(tempDir, CORRECTION_XML);
  try {
    writeFileSync(tempPath, bytes, { flag: "wx", mode: 0o600 });
    validateRealBookFile(tempPath, repoRoot);
    assertCorrectionHeader(bytes.toString("latin1"));
    await assertCorrectionMultipart(bytes);
    if (!snapshotStillMatches(previousArtifacts) || !snapshotStillMatches(previousRegistries)) realFail("correction_previous_state");
    mkdirSync(CORRECTION_OUTPUT_DIR, { recursive: false, mode: 0o700 });
    chmodSync(CORRECTION_OUTPUT_DIR, 0o700);
    const xmlPath = correctionPath(CORRECTION_XML);
    writeFileSync(xmlPath, bytes, { flag: "wx", mode: 0o600 }); chmodSync(xmlPath, 0o600);
    validateRealBookFile(xmlPath, repoRoot);
    await assertCorrectionMultipart(readFileSync(xmlPath));
    if (!snapshotStillMatches(previousArtifacts) || !snapshotStillMatches(previousRegistries)) realFail("correction_previous_state");
    rejectedEvidence();
    const manifest = {
      schemaVersion: 1, artifactKind: "certification_sales_book_correction", setNumber: "4959699", libroType: "VENTAS",
      ...correctionLinkage(), correctionOfManifestSha256: rejected.manifestSha256, correctionOfRegistrySha256: rejected.registrySha256,
      sourceSetNumber: "4959698", sourceEnvelopeSha256: source.sourceEnvelopeSha256, sourceManifestSha256: source.sourceManifestSha256,
      detailsCount: 8, totalsMatch: true, referencesMatchAcceptedSet: true,
      periodoTributario: "2026-07", tipoOperacion: "VENTA", tipoLibro: "ESPECIAL", tipoEnvio: "TOTAL", folioNotificacion: 1,
      rootQName: "LibroCompraVenta", namespaceExact: true, xsiPhysicallyDeclared: true, schemaLocationExact: true,
      schemaLocation: SCHEMA_LOCATION, noNamespaceSchemaLocationPresent: false,
      xmlSyntax: "valid", libroCvXsd: "valid", xmlsec1SignatureValid: true, certificateKeyMatch: true,
      signatureAuthority: "xmlsec1", internalVerifier: "non_authoritative", encoding: "ISO-8859-1", bom: "absent",
      outputOutsideRepo: true, previousArtifactSnapshotSha256: previousArtifacts.digest,
      previousRegistrySnapshotSha256: previousRegistries.digest, previousArtifactUnchanged: true, previousRegistryUnchanged: true,
      multipartBytesEqualArtifact: true, multipartContentType: "text/xml", multipartFilenameExtension: ".xml",
      signatureTimestamp: timestamp, xmlFile: CORRECTION_XML, xmlSha256: sha256(bytes), generatedAt: new Date().toISOString(),
    };
    const manifestPath = correctionPath(CORRECTION_MANIFEST);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 }); chmodSync(manifestPath, 0o600);
    const registryPath = correctionPath(CORRECTION_REGISTRY);
    writeFileSync(registryPath, `${JSON.stringify({ at: new Date().toISOString(), ...correctionLinkage(), stage: "preflight_passed", setNumber: "4959699", libroType: "VENTAS", xmlSha256: manifest.xmlSha256, manifestSha256: shaFile(manifestPath), multipartBytesEqualArtifact: true, multipartContentType: "text/xml", statusQueryEnabled: false })}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(registryPath, 0o600);
    await auditPreparedCorrection(repoRoot);
    return correctionPublicResult();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function submitPreparedRealSalesBookCorrection(repoRoot: string = process.cwd(), fetchImpl: typeof fetch = fetch): Promise<CorrectionResult> {
  const source = await auditPreparedCorrection(repoRoot);
  const registryPath = correctionPath(CORRECTION_REGISTRY);
  const events = readFileSync(registryPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  if (events.length !== 1 || events[0].stage !== "preflight_passed" || events.some((event) => event.stage === "upload_started")) realFail("correction_submit_already_attempted");
  const config: SiiCertificationConfig = {
    environment: "certification", seedUrl: SII_CERTIFICATION_SEED_URL, tokenUrl: SII_CERTIFICATION_TOKEN_URL,
    submitUrl: SET_SUBMIT_URL, statusUrl: "", certPath: REAL_CERT, privateKeyPath: REAL_KEY,
    cafPath: null, cafPrivateKeyPath: null, rutEmpresa: source.issuerRut, rutUsuario: source.senderRut,
    timeoutMs: 30_000, enableSubmit: true,
  };
  let siiContacted = false;
  let submitExecuted = false;
  let tokenFingerprint: string | null = null;
  try {
    appendCorrectionRegistry({ stage: "seed_started" });
    const seed = await requestSeed(config, { fetchImpl }); siiContacted = true;
    if (!seed.seed) realFail("correction_seed_response");
    appendCorrectionRegistry({ stage: "seed_completed" });
    const token = await requestToken(signSeed(seed.seed, config).signedSeed ?? "", config, { fetchImpl });
    if (!token.token) realFail("correction_token_response");
    tokenFingerprint = sha256(Buffer.from(token.token)).slice(0, 16);
    appendCorrectionRegistry({ stage: "token_completed", tokenFingerprint });
    const sender = safeRutParts(source.senderRut);
    const company = safeRutParts(source.issuerRut);
    const bytes = readFileSync(correctionPath(CORRECTION_XML));
    const blob = new Blob([Uint8Array.from(bytes)], { type: "text/xml" });
    if (!Buffer.from(await blob.arrayBuffer()).equals(bytes) || blob.type !== "text/xml") realFail("correction_multipart");
    const form = new FormData();
    form.set("rutSender", sender.rut); form.set("dvSender", sender.dv);
    form.set("rutCompany", company.rut); form.set("dvCompany", company.dv);
    form.set("archivo", blob, CORRECTION_XML);
    appendCorrectionRegistry({ stage: "upload_started", endpointOrigin: "https://maullin.sii.cl", endpointPath: "/cgi_dte/UPL/DTEUpload", multipartBuilt: true, multipartBytesEqualArtifact: true, multipartContentType: "text/xml", multipartFilenameExtension: ".xml", redirectPolicy: "manual" });
    submitExecuted = true;
    const response = await fetchImpl(SET_SUBMIT_URL, {
      method: "POST",
      headers: { "user-agent": "PROG 1.0", accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8", "accept-language": "es-cl", referer: "https://maullin.sii.cl/", "cache-control": "no-cache", cookie: `TOKEN=${token.token}` },
      body: form, redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs),
    });
    siiContacted = true;
    const raw = await response.text();
    const classification = classifyUploadResponse(raw);
    const parsed = parseSafeReception(raw);
    const submitted = response.ok && classification.kind === "accepted" && Boolean(classification.trackId);
    appendCorrectionRegistry({
      stage: submitted ? "submitted" : classification.kind === "rejected" ? "rejected" : "ambiguous",
      httpStatus: response.status, responseContentType: response.headers.get("content-type"),
      responseBody: raw, responseBytes: Buffer.byteLength(raw, "utf8"), responseSha256: sha256(Buffer.from(raw)),
      receptionStatus: classification.status ?? parsed.status ?? "invalid", safeGlosa: parsed.glosa,
      safeErrorCount: parsed.errorMessages.length, safeErrorCodes: parsed.errorCodes,
      safeErrorMessages: parsed.errorMessages, line: parsed.line, column: parsed.column,
      semanticCategory: classification.semanticCategory, trackId: submitted ? classification.trackId : undefined,
      tokenFingerprint, submitted, statusQueried: false,
    });
    return {
      ...correctionPublicResult(), submitExecuted: true,
      receptionStatus: classification.status ?? parsed.status ?? "invalid",
      safeGlosa: parsed.glosa, safeErrorCodes: parsed.errorCodes.join(","),
      submitted, trackId: submitted ? String(classification.trackId) : "", siiContacted, statusQueried: false,
    };
  } catch (error) {
    appendCorrectionRegistry({ stage: submitExecuted ? "ambiguous" : "auth_failed", tokenFingerprint, submitExecuted, siiContacted, statusQueried: false });
    throw error;
  }
}

export function formatSalesBookCorrectionResult(result: CorrectionResult): string {
  return Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n");
}

const DELIVERY_ATTEMPT_002_ID = "sales-book-correction-001-delivery-attempt-002";
const DELIVERY_ATTEMPT_002_DIR = join(REAL_SALES_ROOT, DELIVERY_ATTEMPT_002_ID);
const DELIVERY_ATTEMPT_002_REGISTRY = "registry.jsonl";

type DeliveryAttempt002Result = {
  preflightStatus: "PASS";
  attemptId: typeof DELIVERY_ATTEMPT_002_ID;
  artifactSha256Unchanged: boolean;
  seedCompleted: boolean;
  tokenCompleted: boolean;
  multipartBuilt: boolean;
  uploadStarted: boolean;
  responseHeadersReceived: boolean;
  responseBodyStored: boolean;
  httpStatus: number | "";
  receptionStatus: string;
  safeGlosa: string;
  safeErrorCodes: string;
  submitted: boolean;
  trackId: string;
  siiContacted: boolean;
  statusQueried: false;
};

type TransportEvent = Record<string, unknown> & { stage: string };

function safeErrorField(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]{1,80}$/.test(text) ? text : null;
}
function transportErrorFields(error: unknown): { errorName: string | null; errorCode: string | null; causeCode: string | null } {
  const value = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; cause?: unknown } : {};
  const cause = value.cause && typeof value.cause === "object" ? value.cause as { code?: unknown; name?: unknown } : {};
  return {
    errorName: safeErrorField(value.name), errorCode: safeErrorField(value.code),
    causeCode: safeErrorField(cause.code ?? cause.name),
  };
}

export async function executeRecordedMultipartTransport(input: {
  fetchImpl: typeof fetch;
  endpoint: string;
  request: RequestInit;
  append: (event: TransportEvent) => void;
}): Promise<{ response: Response; raw: string }> {
  let responseHeadersReceived = false;
  let responseBodyStarted = false;
  let responseBodyStored = false;
  let httpStatus: number | null = null;
  let failureStage = "fetch";
  input.append({ stage: "upload_started", uploadStarted: true });
  try {
    const response = await input.fetchImpl(input.endpoint, input.request);
    responseHeadersReceived = true;
    httpStatus = response.status;
    input.append({ stage: "response_headers_received", responseHeadersReceived: true, httpStatus });
    failureStage = "response_body";
    responseBodyStarted = true;
    input.append({ stage: "response_body_started", responseBodyStarted: true, httpStatus });
    const raw = await response.text();
    responseBodyStored = true;
    input.append({
      stage: "response_body_stored", responseHeadersReceived: true, responseBodyStarted: true,
      responseBodyStored: true, httpStatus, responseBody: raw,
      responseBytes: Buffer.byteLength(raw, "utf8"), responseSha256: sha256(Buffer.from(raw)),
    });
    return { response, raw };
  } catch (error) {
    input.append({
      stage: "transport_failed", failureStage, responseHeadersReceived, responseBodyStarted,
      responseBodyStored, httpStatus, ...transportErrorFields(error),
    });
    throw error;
  }
}

function deliveryAttempt002Path(): string { return join(DELIVERY_ATTEMPT_002_DIR, DELIVERY_ATTEMPT_002_REGISTRY); }
function appendDeliveryAttempt002(event: TransportEvent): void {
  const path = deliveryAttempt002Path();
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), attemptId: DELIVERY_ATTEMPT_002_ID, correctionArtifactSha256: shaFile(correctionPath(CORRECTION_XML)), ...event })}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}
function correctionAttempt001Evidence(): string {
  const path = correctionPath(CORRECTION_REGISTRY);
  const events = readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const terminal = events.at(-1);
  if (events.filter((event) => event.stage === "upload_started").length !== 1 ||
      terminal?.stage !== "ambiguous" || terminal.submitExecuted !== true ||
      terminal.siiContacted !== true || terminal.statusQueried !== false ||
      events.some((event) => event.stage === "response_headers_received" || event.stage === "response_body_stored" || Boolean(event.trackId))) {
    realFail("delivery_attempt_001_evidence");
  }
  return shaFile(path);
}
async function prepareDeliveryAttempt002(repoRoot: string): Promise<{ source: AcceptedSalesSource; artifactSha256: string }> {
  if (existsSync(DELIVERY_ATTEMPT_002_DIR)) realFail("delivery_attempt_002_exists");
  const attempt001RegistrySha256 = correctionAttempt001Evidence();
  const source = await auditPreparedCorrection(repoRoot);
  const manifest = JSON.parse(readFileSync(correctionPath(CORRECTION_MANIFEST), "utf8")) as Record<string, unknown>;
  const artifactSha256 = shaFile(correctionPath(CORRECTION_XML));
  if (artifactSha256 !== manifest.xmlSha256) realFail("delivery_artifact_manifest_sha256");
  mkdirSync(DELIVERY_ATTEMPT_002_DIR, { recursive: false, mode: 0o700 });
  chmodSync(DELIVERY_ATTEMPT_002_DIR, 0o700);
  const registryPath = deliveryAttempt002Path();
  writeFileSync(registryPath, `${JSON.stringify({
    at: new Date().toISOString(), attemptId: DELIVERY_ATTEMPT_002_ID, stage: "preflight_passed",
    manualEvidenceDate: "2026-07-23", thirdAttemptBlocked: true, statusQueryEnabled: false,
    correctionArtifactSha256: artifactSha256, correctionManifestSha256: shaFile(correctionPath(CORRECTION_MANIFEST)),
    correctionAttempt001RegistrySha256: attempt001RegistrySha256,
    schemaLocationExact: true, libroCvXsd: "valid", xmlsec1SignatureValid: true,
    encoding: "ISO-8859-1", bom: "absent", detailsCount: 8, totalsMatch: true,
  })}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(registryPath, 0o600);
  return { source, artifactSha256 };
}
function deliveryAttempt002Result(events: Array<Record<string, unknown>>, values: Partial<DeliveryAttempt002Result> = {}): DeliveryAttempt002Result {
  const stages = events.map((event) => event.stage);
  const terminal = events.at(-1) ?? {};
  return {
    preflightStatus: "PASS", attemptId: DELIVERY_ATTEMPT_002_ID, artifactSha256Unchanged: true,
    seedCompleted: stages.includes("seed_completed"), tokenCompleted: stages.includes("token_completed"),
    multipartBuilt: stages.includes("multipart_built"), uploadStarted: stages.includes("upload_started"),
    responseHeadersReceived: stages.includes("response_headers_received"),
    responseBodyStored: stages.includes("response_body_stored"),
    httpStatus: typeof terminal.httpStatus === "number" ? terminal.httpStatus : "",
    receptionStatus: String(terminal.receptionStatus ?? (terminal.stage === "transport_failed" ? "AMBIGUOUS_TRANSPORT_FAILURE" : "NOT_SUBMITTED")),
    safeGlosa: String(terminal.safeGlosa ?? ""), safeErrorCodes: Array.isArray(terminal.safeErrorCodes) ? terminal.safeErrorCodes.join(",") : "",
    submitted: terminal.submitted === true, trackId: terminal.submitted === true ? String(terminal.trackId ?? "") : "",
    siiContacted: stages.includes("seed_started"), statusQueried: false, ...values,
  };
}

export async function submitSalesBookCorrectionDeliveryAttempt002(repoRoot: string = process.cwd(), fetchImpl: typeof fetch = fetch): Promise<DeliveryAttempt002Result> {
  const prepared = await prepareDeliveryAttempt002(repoRoot);
  const config: SiiCertificationConfig = {
    environment: "certification", seedUrl: SII_CERTIFICATION_SEED_URL, tokenUrl: SII_CERTIFICATION_TOKEN_URL,
    submitUrl: SET_SUBMIT_URL, statusUrl: "", certPath: REAL_CERT, privateKeyPath: REAL_KEY,
    cafPath: null, cafPrivateKeyPath: null, rutEmpresa: prepared.source.issuerRut, rutUsuario: prepared.source.senderRut,
    timeoutMs: 30_000, enableSubmit: true,
  };
  let tokenFingerprint: string | null = null;
  try {
    appendDeliveryAttempt002({ stage: "seed_started", seedCompleted: false });
    const seed = await requestSeed(config, { fetchImpl });
    if (!seed.seed) realFail("delivery_seed_response");
    appendDeliveryAttempt002({ stage: "seed_completed", seedCompleted: true });
    appendDeliveryAttempt002({ stage: "token_started", tokenCompleted: false });
    const token = await requestToken(signSeed(seed.seed, config).signedSeed ?? "", config, { fetchImpl });
    if (!token.token) realFail("delivery_token_response");
    tokenFingerprint = sha256(Buffer.from(token.token)).slice(0, 16);
    appendDeliveryAttempt002({ stage: "token_completed", tokenCompleted: true, tokenFingerprint });
    const sender = safeRutParts(prepared.source.senderRut);
    const company = safeRutParts(prepared.source.issuerRut);
    const bytes = readFileSync(correctionPath(CORRECTION_XML));
    if (sha256(bytes) !== prepared.artifactSha256) realFail("delivery_artifact_changed");
    const blob = new Blob([Uint8Array.from(bytes)], { type: "text/xml" });
    if (blob.type !== "text/xml" || !Buffer.from(await blob.arrayBuffer()).equals(bytes)) realFail("delivery_multipart");
    const form = new FormData();
    form.set("rutSender", sender.rut); form.set("dvSender", sender.dv);
    form.set("rutCompany", company.rut); form.set("dvCompany", company.dv);
    form.set("archivo", blob, CORRECTION_XML);
    appendDeliveryAttempt002({ stage: "multipart_built", multipartBuilt: true, multipartBytesEqualArtifact: true, multipartContentType: "text/xml", multipartFilenameExtension: ".xml" });
    const transport = await executeRecordedMultipartTransport({
      fetchImpl, endpoint: SET_SUBMIT_URL,
      request: {
        method: "POST",
        headers: { "user-agent": "PROG 1.0", accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8", "accept-language": "es-cl", referer: "https://maullin.sii.cl/", "cache-control": "no-cache", cookie: `TOKEN=${token.token}` },
        body: form, redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs),
      },
      append: appendDeliveryAttempt002,
    });
    const classification = classifyUploadResponse(transport.raw);
    const parsed = parseSafeReception(transport.raw);
    const submitted = transport.response.ok && classification.kind === "accepted" && Boolean(classification.trackId);
    appendDeliveryAttempt002({
      stage: submitted ? "submitted" : classification.kind === "rejected" ? "rejected" : "ambiguous",
      responseHeadersReceived: true, responseBodyStored: true, httpStatus: transport.response.status,
      receptionStatus: classification.status ?? parsed.status ?? "invalid", safeGlosa: parsed.glosa,
      safeErrorCount: parsed.errorMessages.length, safeErrorCodes: parsed.errorCodes,
      safeErrorMessages: parsed.errorMessages, line: parsed.line, column: parsed.column,
      semanticCategory: classification.semanticCategory, trackId: submitted ? classification.trackId : undefined,
      tokenFingerprint, submitted, statusQueried: false,
    });
  } catch (error) {
    const current = readFileSync(deliveryAttempt002Path(), "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    if (current.at(-1)?.stage !== "transport_failed") {
      appendDeliveryAttempt002({ stage: "auth_failed", failureStage: current.at(-1)?.stage ?? "preflight", ...transportErrorFields(error), tokenFingerprint, statusQueried: false });
    }
  }
  const events = readFileSync(deliveryAttempt002Path(), "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  return deliveryAttempt002Result(events);
}

export function formatDeliveryAttempt002Result(result: DeliveryAttempt002Result): string {
  return Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n");
}

const PURCHASE_OUTPUT_DIR = join(tmpdir(), "citaya-dte-certification", "purchase-book-4959700", "correction-001");
const PURCHASE_XML = "LibroCompras-4959700-CORRECTION-001.xml";
const PURCHASE_MANIFEST = "manifest-4959700-COMPRAS-correction-001.json";
const PURCHASE_REGISTRY = "registry-4959700-COMPRAS-correction-001.jsonl";
const REAL_PURCHASE_ID = "LibroCompras-4959700-Correction-001";
const PURCHASE_SET_NUMBER = "4959700";
const PURCHASE_CONTRACT = "docs/dte-sii/certification-sets/set-prueba-factura-electronica.txt";
const ACCEPTED_SALES_TRACK_ID = "0253295678";
const REJECTED_PURCHASE_TRACK_ID = "0253296746";
const REJECTED_PURCHASE_DIR = join(REAL_SALES_ROOT, "purchase-book-4959700", "attempt-001");
const REJECTED_PURCHASE_XML = join(REJECTED_PURCHASE_DIR, "LibroCompras-4959700-CERTIFICATION.xml");
const REJECTED_PURCHASE_MANIFEST = join(REJECTED_PURCHASE_DIR, "manifest-4959700-COMPRAS.json");
const REJECTED_PURCHASE_REGISTRY = join(REJECTED_PURCHASE_DIR, "registry-4959700-COMPRAS.jsonl");
const REJECTED_PURCHASE_DELIVERY_REGISTRY = join(REAL_SALES_ROOT, "purchase-book-4959700-delivery-attempt-002", "registry.jsonl");

type PurchaseRuntime = {
  certificatePath: string;
  privateKeyPath: string;
  seedUrl: string;
  tokenUrl: string;
  submitUrl: string;
};
type PurchaseSource = {
  model: ReturnType<typeof buildPurchaseBookModel>;
  issuerRut: string;
  senderRut: string;
  contractSha256: string;
  acceptedSalesRegistrySha256: string;
  rejectedXmlSha256: string;
  rejectedManifestSha256: string;
  rejectedRegistrySha256: string;
  rejectedDeliveryRegistrySha256: string;
  exactSetMatch: true;
};
type PurchaseResult = {
  generationPrepared: boolean;
  setNumber: typeof PURCHASE_SET_NUMBER;
  detailsCount: number;
  exactSetMatch: boolean;
  totalsMatch: boolean;
  referencesValid: boolean;
  schemaLocationExact: boolean;
  xsdValid: boolean;
  xmlsec1Valid: boolean;
  encoding: "ISO-8859-1";
  bom: "absent";
  previousArtifactsUnchanged: boolean;
  previousRegistriesUnchanged: boolean;
  preflightStatus: "PASS";
  submitExecuted: boolean;
  receptionStatus: string;
  submitted: boolean;
  trackId: string;
  siiContacted: boolean;
  statusQueried: false;
};

function purchasePath(name: string): string { return join(PURCHASE_OUTPUT_DIR, name); }
function requiredPurchaseEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) realFail(`purchase_env_${name.toLowerCase()}`);
  return value;
}
function loadPurchaseRuntime(repoRoot: string, env: NodeJS.ProcessEnv): PurchaseRuntime {
  if (env.DTE_MODE === "production" || env.DTE_SII_ENV !== "certification") realFail("purchase_environment");
  const certificatePath = resolve(requiredPurchaseEnv(env, "DTE_CERT_PATH"));
  const privateKeyPath = resolve(requiredPurchaseEnv(env, "DTE_PRIVATE_KEY_PATH"));
  if (!isAbsolute(certificatePath) || !isAbsolute(privateKeyPath) ||
      relativeToRepo(certificatePath, repoRoot) || relativeToRepo(privateKeyPath, repoRoot) ||
      !existsSync(certificatePath) || !existsSync(privateKeyPath)) realFail("purchase_signing_paths");
  const seedUrl = requiredPurchaseEnv(env, "DTE_SII_SEED_URL");
  const tokenUrl = requiredPurchaseEnv(env, "DTE_SII_TOKEN_URL");
  const submitUrl = String(env.DTE_SII_SUBMIT_URL ?? "").trim() || SET_SUBMIT_URL;
  if (seedUrl !== SII_CERTIFICATION_SEED_URL || tokenUrl !== SII_CERTIFICATION_TOKEN_URL || submitUrl !== SET_SUBMIT_URL) realFail("purchase_endpoints");
  assertConfiguredKeyPair(certificatePath, privateKeyPath);
  return { certificatePath, privateKeyPath, seedUrl, tokenUrl, submitUrl };
}
function acceptedSalesRegistrySha256(): string {
  const path = join(DELIVERY_ATTEMPT_002_DIR, DELIVERY_ATTEMPT_002_REGISTRY);
  const events = readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const terminal = events.at(-1);
  if (events.filter((event) => event.stage === "upload_started").length !== 1 ||
      terminal?.stage !== "submitted" || terminal.receptionStatus !== "0" ||
      terminal.trackId !== ACCEPTED_SALES_TRACK_ID || terminal.statusQueried !== false) realFail("purchase_accepted_sales_evidence");
  return shaFile(path);
}
function rejectedPurchaseEvidence(): Pick<PurchaseSource,
  "rejectedXmlSha256" | "rejectedManifestSha256" | "rejectedRegistrySha256" | "rejectedDeliveryRegistrySha256"> {
  const manifest = JSON.parse(readFileSync(REJECTED_PURCHASE_MANIFEST, "utf8")) as Record<string, unknown>;
  const rejectedXmlSha256 = shaFile(REJECTED_PURCHASE_XML);
  if (manifest.setNumber !== PURCHASE_SET_NUMBER || manifest.xmlSha256 !== rejectedXmlSha256 ||
      manifest.detailsCount !== 7 || manifest.encoding !== "ISO-8859-1" || manifest.bom !== "absent") {
    realFail("purchase_rejected_manifest");
  }
  const rejectedXml = readFileSync(REJECTED_PURCHASE_XML, "latin1");
  const rejectedType46 = (rejectedXml.match(/<Detalle>[\s\S]*?<\/Detalle>/g) ?? []).find((detail) =>
    /<TpoDoc>46<\/TpoDoc>/.test(detail) && /<NroDoc>9<\/NroDoc>/.test(detail)) ??
    realFail("purchase_rejected_type46");
  if (!/<RUTDoc>97004000-5<\/RUTDoc>/.test(rejectedType46) ||
      !/<FchDoc>2026-07-01<\/FchDoc>/.test(rejectedType46) ||
      !/<MntNeto>9037<\/MntNeto>/.test(rejectedType46) || /<MntIVA>/.test(rejectedType46) ||
      !/<CodImp>15<\/CodImp>/.test(rejectedType46) || !/<MntImp>1717<\/MntImp>/.test(rejectedType46) ||
      !/<IVARetTotal>1717<\/IVARetTotal>/.test(rejectedType46) || !/<MntTotal>9037<\/MntTotal>/.test(rejectedType46)) {
    realFail("purchase_rejected_content");
  }
  const originalEvents = readFileSync(REJECTED_PURCHASE_REGISTRY, "utf8").trim().split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  if (originalEvents.filter((event) => event.stage === "upload_started").length !== 1 ||
      originalEvents.at(-1)?.stage !== "transport_failed" || originalEvents.some((event) => event.statusQueried === true)) {
    realFail("purchase_rejected_original_registry");
  }
  const deliveryEvents = readFileSync(REJECTED_PURCHASE_DELIVERY_REGISTRY, "utf8").trim().split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const terminal = deliveryEvents.at(-1);
  if (deliveryEvents.filter((event) => event.stage === "upload_started").length !== 1 || terminal?.stage !== "submitted" ||
      terminal.receptionStatus !== "0" || terminal.trackId !== REJECTED_PURCHASE_TRACK_ID || terminal.statusQueried !== false ||
      deliveryEvents.some((event) => event.statusQueried === true)) realFail("purchase_rejected_delivery_registry");
  return {
    rejectedXmlSha256, rejectedManifestSha256: shaFile(REJECTED_PURCHASE_MANIFEST),
    rejectedRegistrySha256: shaFile(REJECTED_PURCHASE_REGISTRY),
    rejectedDeliveryRegistrySha256: shaFile(REJECTED_PURCHASE_DELIVERY_REGISTRY),
  };
}
function loadPurchaseSource(repoRoot: string): PurchaseSource {
  const loaded = loadFacturaPreCafInputFromPath({
    inputPath: REAL_INPUT, repoRoot, env: { NODE_ENV: process.env.NODE_ENV, DTE_FACTURA_PRE_CAF_ISSUE_DATE: "2026-07-22" },
  });
  if (!loaded.ok || !validatePreCafExternalData(loaded.input).ok) realFail("purchase_external_contract");
  const issuer = loaded.input.issuer ?? realFail("purchase_issuer");
  const providers = Object.fromEntries(Object.entries(loaded.input.purchaseProviders ?? {}).map(([caseId, provider]) => [
    caseId, { rut: String(provider.rut), name: String(provider.razonSocial) },
  ]));
  const model = buildPurchaseBookModel({
    externalData: {
      rutEmisorLibro: String(issuer.rutEmisor), rutEnvia: String(issuer.rutEnvia),
      periodoTributario: String(issuer.periodoTributario), fchResol: String(issuer.fechaResolucion),
      nroResol: Number(issuer.numeroResolucion),
    },
    providers, salesBookPeriod: "2026-07",
  });
  const totalsMatch = model.detalle.every((detail, index) => {
    const contract = PURCHASE_BOOK_SET_4959700[index];
    return detail.caseId === contract.caseId && detail.tpoDoc === contract.tpoDoc && detail.folio === contract.folio &&
      detail.mntExe === contract.mntExe && detail.mntNeto === contract.mntNeto && detail.mntTotal === contract.expectedTotal;
  });
  const referencesValid = JSON.stringify(model.detalle.map((detail) => [detail.tpoDoc, detail.folio])) ===
    JSON.stringify(PURCHASE_BOOK_SET_4959700.map((entry) => [entry.tpoDoc, entry.folio]));
  const type46 = model.detalle.find((detail) => detail.tpoDoc === 46 && detail.folio === 9);
  const exactSetMatch = totalsMatch && referencesValid && type46?.providerRut === "97004000-5" &&
    type46.fchDoc === "2026-07-01" && type46.mntNeto === 9037 && type46.mntIVA === 1717 &&
    type46.ivaUsoComun === 0 && type46.ivaNoRec === undefined &&
    type46.otrosImp?.codImp === 15 && type46.otrosImp.tasaImp === 19 && type46.otrosImp.mntImp === 1717 &&
    type46.ivaRetTotal === 1717 && type46.ivaNoRetenido === 0 && type46.mntTotal === 9037;
  if (model.attention !== PURCHASE_SET_NUMBER || model.detalle.length !== 7 || !exactSetMatch ||
      model.caratula.periodoTributario !== "2026-07" || model.caratula.tipoOperacion !== "COMPRA" ||
      model.caratula.tipoLibro !== "ESPECIAL" || model.caratula.tipoEnvio !== "TOTAL" ||
      model.caratula.folioNotificacion !== 2) realFail("purchase_model");
  return {
    model, issuerRut: String(issuer.rutEmisor), senderRut: String(issuer.rutEnvia),
    contractSha256: shaFile(resolve(repoRoot, PURCHASE_CONTRACT)),
    acceptedSalesRegistrySha256: acceptedSalesRegistrySha256(),
    ...rejectedPurchaseEvidence(), exactSetMatch: true,
  };
}
function assertPurchaseHeader(xml: string): void {
  const root = xml.match(/<LibroCompraVenta\b([^>]*)>/)?.[1] ?? realFail("purchase_root");
  const attribute = (name: string) => root.match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`))?.[1] ?? null;
  if (attribute("xmlns") !== NS || attribute("version") !== "1.0" ||
      attribute("xmlns:xsi") !== "http://www.w3.org/2001/XMLSchema-instance" ||
      attribute("xsi:schemaLocation") !== SCHEMA_LOCATION ||
      attribute("xsi:noNamespaceSchemaLocation") !== null) realFail("purchase_schema_location");
}
function purchasePublicResult(): PurchaseResult {
  return {
    generationPrepared: true, setNumber: PURCHASE_SET_NUMBER, detailsCount: 7,
    exactSetMatch: true, totalsMatch: true, referencesValid: true, schemaLocationExact: true,
    xsdValid: true, xmlsec1Valid: true, encoding: "ISO-8859-1", bom: "absent",
    previousArtifactsUnchanged: true, previousRegistriesUnchanged: true, preflightStatus: "PASS",
    submitExecuted: false, receptionStatus: "NOT_SUBMITTED", submitted: false,
    trackId: "", siiContacted: false, statusQueried: false,
  };
}
function appendPurchaseRegistry(event: TransportEvent): void {
  const path = purchasePath(PURCHASE_REGISTRY);
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), setNumber: PURCHASE_SET_NUMBER, ...event })}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}
async function assertPurchaseMultipart(bytes: Buffer): Promise<void> {
  const blob = new Blob([Uint8Array.from(bytes)], { type: "text/xml" });
  if (blob.type !== "text/xml" || !Buffer.from(await blob.arrayBuffer()).equals(bytes) || !PURCHASE_XML.endsWith(".xml")) realFail("purchase_multipart");
}
async function auditPreparedPurchase(repoRoot: string, env: NodeJS.ProcessEnv): Promise<{ source: PurchaseSource; runtime: PurchaseRuntime }> {
  const runtime = loadPurchaseRuntime(repoRoot, env);
  const source = loadPurchaseSource(repoRoot);
  const manifest = JSON.parse(readFileSync(purchasePath(PURCHASE_MANIFEST), "utf8")) as Record<string, unknown>;
  const xmlPath = purchasePath(PURCHASE_XML);
  if (manifest.setNumber !== PURCHASE_SET_NUMBER || manifest.libroType !== "COMPRAS" ||
      manifest.artifactKind !== "certification_purchase_book_correction" ||
      manifest.contractSha256 !== source.contractSha256 ||
      manifest.acceptedSalesRegistrySha256 !== source.acceptedSalesRegistrySha256 ||
      manifest.correctionOfTrackId !== REJECTED_PURCHASE_TRACK_ID ||
      manifest.rejectedXmlSha256 !== source.rejectedXmlSha256 ||
      manifest.rejectedManifestSha256 !== source.rejectedManifestSha256 ||
      manifest.rejectedRegistrySha256 !== source.rejectedRegistrySha256 ||
      manifest.rejectedDeliveryRegistrySha256 !== source.rejectedDeliveryRegistrySha256 ||
      manifest.detailsCount !== 7 || manifest.exactSetMatch !== true ||
      manifest.totalsMatch !== true || manifest.referencesValid !== true ||
      manifest.rootQName !== "LibroCompraVenta" || manifest.namespaceExact !== true ||
      manifest.xsiPhysicallyDeclared !== true || manifest.schemaLocationExact !== true ||
      manifest.xmlSha256 !== shaFile(xmlPath) || manifest.libroCvXsd !== "valid" ||
      manifest.xmlsec1SignatureValid !== true || manifest.encoding !== "ISO-8859-1" ||
      manifest.bom !== "absent" || manifest.previousArtifactsUnchanged !== true ||
      manifest.previousRegistriesUnchanged !== true || manifest.endpoint !== SET_SUBMIT_URL) realFail("purchase_manifest");
  if (snapshotPrevious("artifacts", PURCHASE_OUTPUT_DIR).digest !== manifest.previousArtifactSnapshotSha256 ||
      snapshotPrevious("registries", PURCHASE_OUTPUT_DIR).digest !== manifest.previousRegistrySnapshotSha256) realFail("purchase_previous_state");
  validateRealBookFile(xmlPath, repoRoot, REAL_PURCHASE_ID, runtime.certificatePath);
  const bytes = readFileSync(xmlPath);
  const xml = bytes.toString("latin1");
  assertPurchaseHeader(xml);
  const envio = extractElement(xml, "EnvioLibro");
  const expected = extractElement(serializePurchaseBookXml(source.model, {
    id: REAL_PURCHASE_ID, includeSchemaLocation: true, timestamp: String(manifest.signatureTimestamp),
  }), "EnvioLibro");
  if (envio !== expected) realFail("purchase_content");
  await assertPurchaseMultipart(bytes);
  return { source, runtime };
}

export async function prepareRealPurchaseBook(repoRoot: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<PurchaseResult> {
  if (existsSync(PURCHASE_OUTPUT_DIR)) realFail("purchase_attempt_exists");
  if (!isAbsolute(PURCHASE_OUTPUT_DIR) || relativeToRepo(PURCHASE_OUTPUT_DIR, repoRoot)) realFail("purchase_output");
  const runtime = loadPurchaseRuntime(repoRoot, env);
  const source = loadPurchaseSource(repoRoot);
  const previousArtifacts = snapshotPrevious("artifacts", PURCHASE_OUTPUT_DIR);
  const previousRegistries = snapshotPrevious("registries", PURCHASE_OUTPUT_DIR);
  const timestamp = santiagoTimestamp();
  const unsignedXml = serializePurchaseBookXml(source.model, {
    id: REAL_PURCHASE_ID, includeSchemaLocation: true, timestamp,
  });
  assertPurchaseHeader(unsignedXml);
  const signed = signXmlInFinalContextControlled({
    xml: unsignedXml, referenceId: REAL_PURCHASE_ID,
    insertAfterXPath: `//*[local-name()='EnvioLibro' and @ID='${REAL_PURCHASE_ID}']`,
  }, configuredSigningConfig(REAL_PURCHASE_ID, runtime.certificatePath, runtime.privateKeyPath));
  const bytes = encodeIso88591Strict(signed.signedXml);
  const tempDir = mkdtempSync(join(tmpdir(), "citaya-purchase-book-4959700-"));
  const tempPath = join(tempDir, PURCHASE_XML);
  try {
    writeFileSync(tempPath, bytes, { flag: "wx", mode: 0o600 });
    validateRealBookFile(tempPath, repoRoot, REAL_PURCHASE_ID, runtime.certificatePath);
    assertPurchaseHeader(bytes.toString("latin1"));
    await assertPurchaseMultipart(bytes);
    if (!snapshotStillMatches(previousArtifacts) || !snapshotStillMatches(previousRegistries)) realFail("purchase_previous_state");
    mkdirSync(PURCHASE_OUTPUT_DIR, { recursive: true, mode: 0o700 }); chmodSync(PURCHASE_OUTPUT_DIR, 0o700);
    const xmlPath = purchasePath(PURCHASE_XML);
    writeFileSync(xmlPath, bytes, { flag: "wx", mode: 0o600 }); chmodSync(xmlPath, 0o600);
    validateRealBookFile(xmlPath, repoRoot, REAL_PURCHASE_ID, runtime.certificatePath);
    await assertPurchaseMultipart(readFileSync(xmlPath));
    if (!snapshotStillMatches(previousArtifacts) || !snapshotStillMatches(previousRegistries)) realFail("purchase_previous_state");
    const manifest = {
      schemaVersion: 1, artifactKind: "certification_purchase_book_correction", setNumber: PURCHASE_SET_NUMBER, libroType: "COMPRAS",
      contractSha256: source.contractSha256, acceptedSalesRegistrySha256: source.acceptedSalesRegistrySha256,
      correctionOfTrackId: REJECTED_PURCHASE_TRACK_ID,
      rejectedXmlSha256: source.rejectedXmlSha256, rejectedManifestSha256: source.rejectedManifestSha256,
      rejectedRegistrySha256: source.rejectedRegistrySha256,
      rejectedDeliveryRegistrySha256: source.rejectedDeliveryRegistrySha256,
      rootCause: "MntIVA omitted for type 46 folio 9 with total VAT withholding",
      type46Folio9Corrected: {
        rut: "97004000-5", date: "2026-07-01", tpoDoc: 46, mntNeto: 9037, tasaImp: 19,
        mntIVA: 1717, mntIVANoRec: null, ivaUsoComun: null, codImp: 15, mntImp: 1717,
        ivaRetTotal: 1717, ivaNoRetenido: 0, mntTotal: 9037,
      },
      detailsCount: 7, exactSetMatch: true, totalsMatch: true, referencesValid: true,
      periodoTributario: "2026-07", tipoOperacion: "COMPRA", tipoLibro: "ESPECIAL", tipoEnvio: "TOTAL", folioNotificacion: 2,
      rootQName: "LibroCompraVenta", namespaceExact: true, xsiPhysicallyDeclared: true,
      schemaLocationExact: true, schemaLocation: SCHEMA_LOCATION,
      xmlSyntax: "valid", libroCvXsd: "valid", xmlsec1SignatureValid: true, certificateKeyMatch: true,
      signatureAuthority: "xmlsec1", internalVerifier: "non_authoritative",
      encoding: "ISO-8859-1", bom: "absent", outputOutsideRepo: true,
      previousArtifactSnapshotSha256: previousArtifacts.digest, previousRegistrySnapshotSha256: previousRegistries.digest,
      previousArtifactsUnchanged: true, previousRegistriesUnchanged: true,
      multipartBytesEqualArtifact: true, multipartContentType: "text/xml", endpoint: runtime.submitUrl,
      signatureTimestamp: timestamp, xmlFile: PURCHASE_XML, xmlSha256: sha256(bytes), generatedAt: new Date().toISOString(),
    };
    const manifestPath = purchasePath(PURCHASE_MANIFEST);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 }); chmodSync(manifestPath, 0o600);
    const registryPath = purchasePath(PURCHASE_REGISTRY);
    writeFileSync(registryPath, `${JSON.stringify({
      at: new Date().toISOString(), setNumber: PURCHASE_SET_NUMBER, stage: "preflight_passed",
      xmlSha256: manifest.xmlSha256, manifestSha256: shaFile(manifestPath), endpoint: runtime.submitUrl,
      detailsCount: 7, exactSetMatch: true, totalsMatch: true, referencesValid: true, schemaLocationExact: true,
      libroCvXsd: "valid", xmlsec1SignatureValid: true, statusQueryEnabled: false, retryBlocked: true,
    })}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(registryPath, 0o600);
    await auditPreparedPurchase(repoRoot, env);
    return purchasePublicResult();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function submitPreparedRealPurchaseBook(repoRoot: string = process.cwd(), env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<PurchaseResult> {
  const prepared = await auditPreparedPurchase(repoRoot, env);
  const registryPath = purchasePath(PURCHASE_REGISTRY);
  const initialEvents = readFileSync(registryPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  if (initialEvents.length !== 1 || initialEvents[0].stage !== "preflight_passed" ||
      initialEvents.some((event) => event.stage === "upload_started")) realFail("purchase_submit_already_attempted");
  const config: SiiCertificationConfig = {
    environment: "certification", seedUrl: prepared.runtime.seedUrl, tokenUrl: prepared.runtime.tokenUrl,
    submitUrl: prepared.runtime.submitUrl, statusUrl: "", certPath: prepared.runtime.certificatePath,
    privateKeyPath: prepared.runtime.privateKeyPath, cafPath: null, cafPrivateKeyPath: null,
    rutEmpresa: prepared.source.issuerRut, rutUsuario: prepared.source.senderRut,
    timeoutMs: 30_000, enableSubmit: true,
  };
  let tokenFingerprint: string | null = null;
  try {
    appendPurchaseRegistry({ stage: "seed_started", seedCompleted: false });
    const seed = await requestSeed(config, { fetchImpl });
    if (!seed.seed) realFail("purchase_seed_response");
    appendPurchaseRegistry({ stage: "seed_completed", seedCompleted: true });
    appendPurchaseRegistry({ stage: "token_started", tokenCompleted: false });
    const token = await requestToken(signSeed(seed.seed, config).signedSeed ?? "", config, { fetchImpl });
    if (!token.token) realFail("purchase_token_response");
    tokenFingerprint = sha256(Buffer.from(token.token)).slice(0, 16);
    appendPurchaseRegistry({ stage: "token_completed", tokenCompleted: true, tokenFingerprint });
    const sender = safeRutParts(prepared.source.senderRut);
    const company = safeRutParts(prepared.source.issuerRut);
    const bytes = readFileSync(purchasePath(PURCHASE_XML));
    const manifest = JSON.parse(readFileSync(purchasePath(PURCHASE_MANIFEST), "utf8")) as Record<string, unknown>;
    if (sha256(bytes) !== manifest.xmlSha256) realFail("purchase_artifact_changed");
    const blob = new Blob([Uint8Array.from(bytes)], { type: "text/xml" });
    if (blob.type !== "text/xml" || !Buffer.from(await blob.arrayBuffer()).equals(bytes)) realFail("purchase_multipart");
    const form = new FormData();
    form.set("rutSender", sender.rut); form.set("dvSender", sender.dv);
    form.set("rutCompany", company.rut); form.set("dvCompany", company.dv);
    form.set("archivo", blob, PURCHASE_XML);
    appendPurchaseRegistry({ stage: "multipart_built", multipartBuilt: true, multipartBytesEqualArtifact: true, multipartContentType: "text/xml", endpointExact: true });
    const transport = await executeRecordedMultipartTransport({
      fetchImpl, endpoint: prepared.runtime.submitUrl,
      request: {
        method: "POST",
        headers: { "user-agent": "PROG 1.0", accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8", "accept-language": "es-cl", referer: "https://maullin.sii.cl/", "cache-control": "no-cache", cookie: `TOKEN=${token.token}` },
        body: form, redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs),
      },
      append: appendPurchaseRegistry,
    });
    const classification = classifyUploadResponse(transport.raw);
    const parsed = parseSafeReception(transport.raw);
    const submitted = transport.response.ok && classification.kind === "accepted" && Boolean(classification.trackId);
    appendPurchaseRegistry({
      stage: submitted ? "submitted" : classification.kind === "rejected" ? "rejected" : "ambiguous",
      responseHeadersReceived: true, responseBodyStored: true, httpStatus: transport.response.status,
      receptionStatus: classification.status ?? parsed.status ?? "invalid", safeGlosa: parsed.glosa,
      safeErrorCount: parsed.errorMessages.length, safeErrorCodes: parsed.errorCodes,
      safeErrorMessages: parsed.errorMessages, line: parsed.line, column: parsed.column,
      semanticCategory: classification.semanticCategory, trackId: submitted ? classification.trackId : undefined,
      tokenFingerprint, submitted, statusQueried: false,
    });
  } catch (error) {
    const events = readFileSync(registryPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    if (events.at(-1)?.stage !== "transport_failed") {
      appendPurchaseRegistry({ stage: "auth_failed", failureStage: events.at(-1)?.stage ?? "preflight", ...transportErrorFields(error), tokenFingerprint, statusQueried: false });
    }
  }
  const events = readFileSync(registryPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const stages = events.map((event) => event.stage);
  const terminal = events.at(-1) ?? {};
  return {
    ...purchasePublicResult(), submitExecuted: stages.includes("upload_started"),
    receptionStatus: String(terminal.receptionStatus ?? (terminal.stage === "transport_failed" ? "AMBIGUOUS_TRANSPORT_FAILURE" : "invalid")),
    submitted: terminal.submitted === true, trackId: terminal.submitted === true ? String(terminal.trackId ?? "") : "",
    siiContacted: stages.includes("seed_started"), statusQueried: false,
  };
}

export function formatPurchaseBookResult(result: PurchaseResult): string {
  return Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n");
}

const PURCHASE_DELIVERY_ATTEMPT_002_ID = "purchase-book-4959700-delivery-attempt-002";
const PURCHASE_DELIVERY_ATTEMPT_002_DIR = join(REAL_SALES_ROOT, PURCHASE_DELIVERY_ATTEMPT_002_ID);
const PURCHASE_DELIVERY_ATTEMPT_002_REGISTRY = "registry.jsonl";

type PurchaseDeliveryAttempt002Result = {
  preflightStatus: "PASS";
  attemptId: typeof PURCHASE_DELIVERY_ATTEMPT_002_ID;
  artifactSha256Unchanged: boolean;
  seedCompleted: boolean;
  tokenCompleted: boolean;
  multipartBuilt: boolean;
  uploadStarted: boolean;
  responseHeadersReceived: boolean;
  responseBodyStored: boolean;
  httpStatus: number | "";
  receptionStatus: string;
  safeGlosa: string;
  safeErrorCodes: string;
  submitted: boolean;
  trackId: string;
  siiContacted: boolean;
  statusQueried: false;
};

function purchaseDeliveryAttempt002Path(): string {
  return join(PURCHASE_DELIVERY_ATTEMPT_002_DIR, PURCHASE_DELIVERY_ATTEMPT_002_REGISTRY);
}
function appendPurchaseDeliveryAttempt002(event: TransportEvent): void {
  const path = purchaseDeliveryAttempt002Path();
  appendFileSync(path, `${JSON.stringify({
    at: new Date().toISOString(), attemptId: PURCHASE_DELIVERY_ATTEMPT_002_ID,
    artifactSha256: shaFile(purchasePath(PURCHASE_XML)), ...event,
  })}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}
function purchaseAttempt001Evidence(): string {
  const path = purchasePath(PURCHASE_REGISTRY);
  const events = readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const terminal = events.at(-1);
  if (events.filter((event) => event.stage === "upload_started").length !== 1 ||
      terminal?.stage !== "transport_failed" ||
      events.some((event) => event.receptionStatus === "0" || Boolean(event.trackId) ||
        event.stage === "response_headers_received" || event.stage === "response_body_stored" ||
        event.statusQueried === true)) realFail("purchase_attempt_001_evidence");
  return shaFile(path);
}
async function preparePurchaseDeliveryAttempt002(repoRoot: string, env: NodeJS.ProcessEnv): Promise<{
  source: PurchaseSource;
  runtime: PurchaseRuntime;
  artifactSha256: string;
}> {
  if (existsSync(PURCHASE_DELIVERY_ATTEMPT_002_DIR)) realFail("purchase_delivery_attempt_002_exists");
  const attempt001RegistrySha256 = purchaseAttempt001Evidence();
  const prepared = await auditPreparedPurchase(repoRoot, env);
  const artifactSha256 = shaFile(purchasePath(PURCHASE_XML));
  const manifestSha256 = shaFile(purchasePath(PURCHASE_MANIFEST));
  const manifest = JSON.parse(readFileSync(purchasePath(PURCHASE_MANIFEST), "utf8")) as Record<string, unknown>;
  if (artifactSha256 !== manifest.xmlSha256 || manifest.detailsCount !== 7 ||
      manifest.totalsMatch !== true || manifest.referencesValid !== true ||
      manifest.schemaLocationExact !== true || manifest.libroCvXsd !== "valid" ||
      manifest.xmlsec1SignatureValid !== true || manifest.encoding !== "ISO-8859-1" ||
      manifest.bom !== "absent" || manifest.endpoint !== SET_SUBMIT_URL) realFail("purchase_delivery_preflight");
  mkdirSync(PURCHASE_DELIVERY_ATTEMPT_002_DIR, { recursive: false, mode: 0o700 });
  chmodSync(PURCHASE_DELIVERY_ATTEMPT_002_DIR, 0o700);
  const registryPath = purchaseDeliveryAttempt002Path();
  writeFileSync(registryPath, `${JSON.stringify({
    at: new Date().toISOString(), attemptId: PURCHASE_DELIVERY_ATTEMPT_002_ID,
    stage: "preflight_passed", manualRetryAuthorized: true, thirdAttemptBlocked: true,
    originalRegistryState: "ambiguous", originalTrackIdPresent: false, originalStatusZeroPresent: false,
    originalRegistrySha256: attempt001RegistrySha256, artifactSha256, manifestSha256,
    detailsCount: 7, totalsMatch: true, referencesValid: true, schemaLocationExact: true,
    libroCvXsd: "valid", xmlsec1SignatureValid: true, encoding: "ISO-8859-1", bom: "absent",
    endpointExact: true, hardenedHeadersActive: true, redirectPolicy: "manual", statusQueryEnabled: false,
  })}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(registryPath, 0o600);
  return { ...prepared, artifactSha256 };
}
function purchaseDeliveryAttempt002Result(events: Array<Record<string, unknown>>): PurchaseDeliveryAttempt002Result {
  const stages = events.map((event) => event.stage);
  const terminal = events.at(-1) ?? {};
  return {
    preflightStatus: "PASS", attemptId: PURCHASE_DELIVERY_ATTEMPT_002_ID,
    artifactSha256Unchanged: true, seedCompleted: stages.includes("seed_completed"),
    tokenCompleted: stages.includes("token_completed"), multipartBuilt: stages.includes("multipart_built"),
    uploadStarted: stages.includes("upload_started"), responseHeadersReceived: stages.includes("response_headers_received"),
    responseBodyStored: stages.includes("response_body_stored"),
    httpStatus: typeof terminal.httpStatus === "number" ? terminal.httpStatus : "",
    receptionStatus: String(terminal.receptionStatus ?? (terminal.stage === "transport_failed" ? "AMBIGUOUS_TRANSPORT_FAILURE" : "invalid")),
    safeGlosa: String(terminal.safeGlosa ?? ""),
    safeErrorCodes: Array.isArray(terminal.safeErrorCodes) ? terminal.safeErrorCodes.join(",") : "",
    submitted: terminal.submitted === true,
    trackId: terminal.submitted === true ? String(terminal.trackId ?? "") : "",
    siiContacted: stages.includes("seed_started"), statusQueried: false,
  };
}

export async function submitPurchaseBookDeliveryAttempt002(
  repoRoot: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PurchaseDeliveryAttempt002Result> {
  const prepared = await preparePurchaseDeliveryAttempt002(repoRoot, env);
  const config: SiiCertificationConfig = {
    environment: "certification", seedUrl: prepared.runtime.seedUrl, tokenUrl: prepared.runtime.tokenUrl,
    submitUrl: prepared.runtime.submitUrl, statusUrl: "", certPath: prepared.runtime.certificatePath,
    privateKeyPath: prepared.runtime.privateKeyPath, cafPath: null, cafPrivateKeyPath: null,
    rutEmpresa: prepared.source.issuerRut, rutUsuario: prepared.source.senderRut,
    timeoutMs: 30_000, enableSubmit: true,
  };
  let tokenFingerprint: string | null = null;
  try {
    appendPurchaseDeliveryAttempt002({ stage: "seed_started", seedCompleted: false });
    const seed = await requestSeed(config, { fetchImpl });
    if (!seed.seed) realFail("purchase_delivery_seed_response");
    appendPurchaseDeliveryAttempt002({ stage: "seed_completed", seedCompleted: true });
    appendPurchaseDeliveryAttempt002({ stage: "token_started", tokenCompleted: false });
    const token = await requestToken(signSeed(seed.seed, config).signedSeed ?? "", config, { fetchImpl });
    if (!token.token) realFail("purchase_delivery_token_response");
    tokenFingerprint = sha256(Buffer.from(token.token)).slice(0, 16);
    appendPurchaseDeliveryAttempt002({ stage: "token_completed", tokenCompleted: true, tokenFingerprint });
    const sender = safeRutParts(prepared.source.senderRut);
    const company = safeRutParts(prepared.source.issuerRut);
    const bytes = readFileSync(purchasePath(PURCHASE_XML));
    if (sha256(bytes) !== prepared.artifactSha256) realFail("purchase_delivery_artifact_changed");
    const blob = new Blob([Uint8Array.from(bytes)], { type: "text/xml" });
    if (blob.type !== "text/xml" || !Buffer.from(await blob.arrayBuffer()).equals(bytes)) realFail("purchase_delivery_multipart");
    const form = new FormData();
    form.set("rutSender", sender.rut); form.set("dvSender", sender.dv);
    form.set("rutCompany", company.rut); form.set("dvCompany", company.dv);
    form.set("archivo", blob, PURCHASE_XML);
    appendPurchaseDeliveryAttempt002({
      stage: "multipart_built", multipartBuilt: true, multipartBytesEqualArtifact: true,
      multipartContentType: "text/xml", endpointExact: true, hardenedHeadersActive: true, redirectPolicy: "manual",
    });
    const transport = await executeRecordedMultipartTransport({
      fetchImpl, endpoint: prepared.runtime.submitUrl,
      request: {
        method: "POST",
        headers: { "user-agent": "PROG 1.0", accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8", "accept-language": "es-cl", referer: "https://maullin.sii.cl/", "cache-control": "no-cache", cookie: `TOKEN=${token.token}` },
        body: form, redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs),
      },
      append: appendPurchaseDeliveryAttempt002,
    });
    const classification = classifyUploadResponse(transport.raw);
    const parsed = parseSafeReception(transport.raw);
    const submitted = transport.response.ok && classification.kind === "accepted" && Boolean(classification.trackId);
    appendPurchaseDeliveryAttempt002({
      stage: submitted ? "submitted" : classification.kind === "rejected" ? "rejected" : "ambiguous",
      responseHeadersReceived: true, responseBodyStored: true, httpStatus: transport.response.status,
      receptionStatus: classification.status ?? parsed.status ?? "invalid", safeGlosa: parsed.glosa,
      safeErrorCount: parsed.errorMessages.length, safeErrorCodes: parsed.errorCodes,
      safeErrorMessages: parsed.errorMessages, line: parsed.line, column: parsed.column,
      semanticCategory: classification.semanticCategory, trackId: submitted ? classification.trackId : undefined,
      tokenFingerprint, submitted, statusQueried: false,
    });
  } catch (error) {
    const events = readFileSync(purchaseDeliveryAttempt002Path(), "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    if (events.at(-1)?.stage !== "transport_failed") {
      appendPurchaseDeliveryAttempt002({
        stage: "auth_failed", failureStage: events.at(-1)?.stage ?? "preflight",
        ...transportErrorFields(error), tokenFingerprint, statusQueried: false,
      });
    }
  }
  const events = readFileSync(purchaseDeliveryAttempt002Path(), "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  return purchaseDeliveryAttempt002Result(events);
}

export function formatPurchaseDeliveryAttempt002Result(result: PurchaseDeliveryAttempt002Result): string {
  return Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n");
}
