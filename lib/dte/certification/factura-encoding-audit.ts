import { createHash, createPublicKey, createVerify, X509Certificate } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalizeXmlControlled, verifyXmlSignatureControlled } from "../signing/sign-xml.real";
import { PRE_CAF_REQUIRED_CASE_ORDER, validatePreCafExternalData } from "./pre-caf-external-contract";
import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";
import {
  encodeIso88591Strict,
  FACTURA_SET_FIXTURE_OUTPUT_DIR,
  runFacturaSetDryRun,
  SII_DTE_NAMESPACE,
  type FacturaSetDryRunOptions,
} from "./factura-set-dry-run";

const XMLDSIG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const XMLDSIG_RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const XMLDSIG_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const EXPECTED_DTE_FILES = PRE_CAF_REQUIRED_CASE_ORDER.map((caseId) => `${caseId}-DTE-FIXTURE-SIN-VALIDEZ.xml`);
const EXPECTED_ENVIO_FILE = "EnvioDTE-4959698-FIXTURE-SIN-VALIDEZ.xml";
const EXPECTED_MANIFEST_FILE = "manifest-4959698-FIXTURE-SIN-VALIDEZ.json";

type AuditFile = {
  name: string;
  path: string;
  bytes: Buffer;
  xml: string;
};

export type FacturaEncodingAuditResult = {
  environment: "certification";
  fixtureMode: true;
  encoding: "ISO-8859-1";
  bom: "absent";
  unsupportedCharacters: 0;
  accentRoundTrip: "ok";
  xmlEntities: "ok";
  cafPreserved: "8/8";
  tedFrmtFinalBytes: "8/8";
  dteSignaturesFinalBytes: "8/8";
  envelopeSignatureFinalBytes: "valid";
  dteXsdFinalBytes: "8/8";
  envioDteXsdFinalBytes: "valid";
  realCaf: false;
  siiContacted: false;
  readyToDownloadCaf: false;
};

export type FacturaEncodingAuditOptions = FacturaSetDryRunOptions & {
  skipGeneration?: boolean;
  outputDir?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeIso88591File(path: string, name: string): AuditFile {
  const bytes = readFileSync(path);
  const hasBom =
    bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ||
    bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ||
    bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]));
  if (hasBom) fail("BOM detectado en XML fixture final");
  if (bytes.includes(Buffer.from("Cajón", "utf8")) || bytes.includes(Buffer.from("Pañuelo", "utf8"))) fail("bytes UTF-8 detectados bajo declaracion ISO-8859-1");
  const xml = bytes.toString("latin1");
  if (!xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')) fail("declaracion XML encoding inconsistente");
  const roundTrip = encodeIso88591Strict(xml);
  if (!roundTrip.equals(bytes)) fail("bytes finales no hacen round-trip ISO-8859-1");
  if (/encoding="UTF-8"/i.test(xml)) fail("declaracion UTF-8 no permitida en artefacto final");
  return { name, path, bytes, xml };
}

function assertNoInvalidXmlCharacters(xml: string): void {
  for (const char of xml) {
    const code = char.codePointAt(0) ?? 0;
    const valid = code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd);
    if (!valid) fail("control XML invalido en archivo final");
    if (code > 0xff) fail("caracter fuera de ISO-8859-1 en archivo final");
  }
}

function extractFirst(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1] ?? fail(`elemento requerido ausente: ${tag}`);
}

function extractElement(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`));
  return match?.[0] ?? fail(`elemento requerido ausente: ${tag}`);
}

function extractLastSignature(xml: string): string {
  const matches = [...xml.matchAll(/<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*?<\/Signature>/g)];
  return matches.at(-1)?.[0] ?? fail("Signature ausente");
}

function extractDteSignature(xml: string): string {
  const matches = [...xml.matchAll(/<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*?<\/Signature>/g)];
  if (matches.length !== 1) fail("DTE final debe contener exactamente una Signature");
  return matches[0][0];
}

function addDefaultNamespace(fragment: string, tag: string): string {
  if (fragment.includes(`xmlns="${SII_DTE_NAMESPACE}"`)) return fragment;
  return fragment.replace(`<${tag} `, `<${tag} xmlns="${SII_DTE_NAMESPACE}" `);
}

function normalizeSignedInfo(signatureXml: string): string {
  const signedInfo = signatureXml.match(/<SignedInfo[\s\S]*?<\/SignedInfo>/)?.[0] ?? fail("SignedInfo ausente");
  if (signedInfo.startsWith('<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">')) return signedInfo;
  return signedInfo
    .split("\n")
    .map((line) => line.replace(/^  /, ""))
    .join("\n")
    .replace(/^<SignedInfo>/, '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
}

function pemFromX509(signatureXml: string): string {
  const x509 = extractFirst(signatureXml, "X509Certificate").replace(/\s+/g, "");
  if (!x509) fail("X509Certificate vacio");
  const cert = new X509Certificate(Buffer.from(x509, "base64"));
  return cert.toString();
}

function assertKeyInfo(signatureXml: string): void {
  const required = ["KeyInfo", "KeyValue", "RSAKeyValue", "Modulus", "Exponent", "X509Data", "X509Certificate"];
  for (const tag of required) {
    const count = (signatureXml.match(new RegExp(`<${tag}(?:\\s|>)`, "g")) ?? []).length;
    if (count !== 1) fail(`KeyInfo incompleto o duplicado: ${tag}`);
  }
  const cert = new X509Certificate(Buffer.from(extractFirst(signatureXml, "X509Certificate").replace(/\s+/g, ""), "base64"));
  const jwk = cert.publicKey.export({ format: "jwk" }) as { kty?: string; n?: string; e?: string };
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) fail("certificado KeyInfo no contiene RSA");
  const modulus = extractFirst(signatureXml, "Modulus").replace(/\s+/g, "");
  const exponent = extractFirst(signatureXml, "Exponent").replace(/\s+/g, "");
  if (base64ToBase64Url(modulus) !== jwk.n || base64ToBase64Url(exponent) !== jwk.e) fail("RSAKeyValue no coincide con X509Certificate");
}

function assertLegacyAlgorithms(signatureXml: string): void {
  for (const algorithm of [XMLDSIG_C14N, XMLDSIG_RSA_SHA1, XMLDSIG_SHA1]) {
    if (!signatureXml.includes(algorithm)) fail("algoritmo XMLDSig legacy ausente");
  }
}

function verifyXmlDsigFromFinalBytes(referenceXml: string, signatureXml: string): boolean {
  assertLegacyAlgorithms(signatureXml);
  assertKeyInfo(signatureXml);
  const canonicalReference = canonicalizeXmlControlled(referenceXml);
  if (!canonicalReference.ok) fail("canonicalizacion final fallo");
  return verifyXmlSignatureControlled({
    signedInfoXml: normalizeSignedInfo(signatureXml),
    signatureValue: extractFirst(signatureXml, "SignatureValue").trim(),
    certificatePem: pemFromX509(signatureXml),
    expectedDigestValue: extractFirst(signatureXml, "DigestValue").trim(),
    canonicalizedReferenceXml: canonicalReference.canonicalXml,
  }).ok;
}

function publicKeyFromCaf(cafXml: string) {
  return createPublicKey({
    key: {
      kty: "RSA",
      n: base64ToBase64Url(extractFirst(cafXml, "M").replace(/\s+/g, "")),
      e: base64ToBase64Url(extractFirst(cafXml, "E").replace(/\s+/g, "")),
    },
    format: "jwk",
  });
}

function verifyFrmtFromFinalBytes(dteXml: string): boolean {
  const ddXml = extractElement(dteXml, "DD");
  const cafXml = extractElement(ddXml, "CAF");
  const frmt = extractFirst(dteXml, "FRMT").replace(/\s+/g, "");
  const verifier = createVerify("RSA-SHA1");
  verifier.update(Buffer.from(ddXml, "latin1"));
  return verifier.verify(publicKeyFromCaf(cafXml), frmt, "base64");
}

function assertTedMatchesDte(dteXml: string): void {
  const ddXml = extractElement(dteXml, "DD");
  const headerPairs: Array<[string, string]> = [
    ["RE", "RUTEmisor"],
    ["TD", "TipoDTE"],
    ["F", "Folio"],
    ["FE", "FchEmis"],
    ["RR", "RUTRecep"],
    ["MNT", "MntTotal"],
  ];
  for (const [ddTag, dteTag] of headerPairs) {
    if (extractFirst(ddXml, ddTag).trim() !== extractFirst(dteXml, dteTag).trim()) fail("TED no coincide con Encabezado final");
  }
  const rsr = extractFirst(ddXml, "RSR");
  const it1 = extractFirst(ddXml, "IT1");
  if (rsr.length > 40 || it1.length > 40) fail("RSR o IT1 excede maximo SII");
  encodeIso88591Strict(rsr);
  encodeIso88591Strict(it1);
  if (it1 !== extractFirst(dteXml, "NmbItem").slice(0, 40)) fail("TED IT1 no coincide con primer detalle final");
}

function validateXsdFinal(file: AuditFile, schemaName: "DTE_v10.xsd" | "EnvioDTE_v10.xsd"): void {
  const result = spawnSync("xmllint", ["--noout", "--schema", schemaName, file.path], {
    cwd: resolve("docs/dte-sii/xsd"),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) fail("XSD final bytes invalido");
}

function readManifest(outputDir: string): { files: Array<{ file: string; sha256: string }>; cafFixtures: Array<{ caseId: string; sha256: string }> } {
  const raw = readFileSync(join(outputDir, EXPECTED_MANIFEST_FILE), "utf8");
  const parsed = JSON.parse(raw) as { files?: Array<{ file?: string; sha256?: string }>; cafFixtures?: Array<{ caseId?: string; sha256?: string }> };
  if (!Array.isArray(parsed.files) || parsed.files.length !== 9) fail("manifest fixture debe contener nueve XML");
  if (!Array.isArray(parsed.cafFixtures) || parsed.cafFixtures.length !== 8) fail("manifest fixture debe contener ocho CAF fixture");
  return {
    files: parsed.files.map((item) => ({ file: String(item.file), sha256: String(item.sha256) })),
    cafFixtures: parsed.cafFixtures.map((item) => ({ caseId: String(item.caseId), sha256: String(item.sha256) })),
  };
}

function assertManifestHashes(outputDir: string, manifest: ReturnType<typeof readManifest>): void {
  for (const item of manifest.files) {
    if (sha256(readFileSync(join(outputDir, item.file))) !== item.sha256) fail("manifest SHA-256 no coincide con XML final");
  }
}

function writeAuditManifest(outputDir: string, files: AuditFile[]): void {
  const manifestPath = join(outputDir, "encoding-audit-4959698-FIXTURE-SIN-VALIDEZ.json");
  writeFileSync(manifestPath, JSON.stringify({
    fixtureMode: true,
    legalValidity: "SIN_VALIDEZ_TRIBUTARIA",
    encoding: "ISO-8859-1",
    files: files.map((file) => ({ file: file.name, sha256: sha256(file.bytes) })),
  }, null, 2), "utf8");
  chmodSync(manifestPath, 0o600);
}

function ensureInputReady(env: NodeJS.ProcessEnv, repoRoot: string): void {
  const loaded = loadFacturaPreCafInputFromPath({ inputPath: env.DTE_FACTURA_PRE_CAF_INPUT_PATH, repoRoot, env: { ...env, DTE_FACTURA_PRE_CAF_ISSUE_DATE: env.DTE_FACTURA_PRE_CAF_ISSUE_DATE ?? env.DTE_CERTIFICATION_ISSUE_DATE } });
  if (!loaded.ok) fail("input PRE-CAF invalido");
  const validation = validatePreCafExternalData(loaded.input);
  if (!validation.ok) fail("contrato PRE-CAF invalido");
}

export function auditFacturaSetFinalFiles(options: FacturaEncodingAuditOptions = {}): FacturaEncodingAuditResult {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? process.cwd();
  if (env.DTE_SII_ENV !== "certification") fail("DTE_SII_ENV debe ser certification para PRE-CAF 9");
  if (env.DTE_MODE === "production") fail("production bloqueado para PRE-CAF 9");
  if (env.DTE_CAF_PATH || env.DTE_CAF_PRIVATE_KEY_PATH) fail("rutas CAF reales bloqueadas para PRE-CAF 9");
  if (env.DTE_SII_ENABLE_SUBMIT === "true" || env.DTE_TRACK_ID || env.DTE_SII_TOKEN) fail("SII submit/token/track_id bloqueado para PRE-CAF 9");
  ensureInputReady(env, repoRoot);

  const outputDir = options.outputDir ?? env.DTE_FACTURA_SET_DRY_RUN_OUTPUT_DIR ?? FACTURA_SET_FIXTURE_OUTPUT_DIR;
  if (!options.skipGeneration) runFacturaSetDryRun({ ...options, outputDir, env, repoRoot });

  const manifest = readManifest(outputDir);
  const dteFiles = EXPECTED_DTE_FILES.map((name) => decodeIso88591File(join(outputDir, name), name));
  const envioFile = decodeIso88591File(join(outputDir, EXPECTED_ENVIO_FILE), EXPECTED_ENVIO_FILE);
  const allFiles = [...dteFiles, envioFile];
  assertManifestHashes(outputDir, manifest);
  for (const file of allFiles) assertNoInvalidXmlCharacters(file.xml);
  if (!dteFiles.some((file) => file.xml.includes("Cajón")) || !dteFiles.some((file) => file.xml.includes("Pañuelo"))) fail("acentos esperados no hacen round-trip");
  if (!dteFiles.some((file) => file.xml.includes("Pintura B&amp;W AFECTO"))) fail("entidad XML esperada para ampersand ausente");
  if (dteFiles.some((file) => file.xml.includes("Pintura B&W AFECTO"))) fail("ampersand sin escapar detectado");

  let cafOk = 0;
  let frmtOk = 0;
  let dteSignatureOk = 0;
  for (const file of dteFiles) {
    validateXsdFinal(file, "DTE_v10.xsd");
    const cafXml = extractElement(extractElement(file.xml, "DD"), "CAF");
    const caseId = file.name.slice(0, "4959698-1".length);
    const cafManifest = manifest.cafFixtures.find((item) => item.caseId === caseId) ?? fail("CAF fixture hash ausente");
    if (sha256(cafXml) === cafManifest.sha256) cafOk += 1;
    if (verifyFrmtFromFinalBytes(file.xml)) frmtOk += 1;
    assertTedMatchesDte(file.xml);
    const documento = addDefaultNamespace(extractElement(file.xml, "Documento"), "Documento");
    if (verifyXmlDsigFromFinalBytes(documento, extractDteSignature(file.xml))) dteSignatureOk += 1;
  }
  if (cafOk !== 8) fail(`CAF fixture no preservado ${cafOk}/8`);
  if (frmtOk !== 8) fail(`FRMT final bytes no verifica ${frmtOk}/8`);
  if (dteSignatureOk !== 8) fail(`XMLDSig DTE final bytes no verifica ${dteSignatureOk}/8`);

  validateXsdFinal(envioFile, "EnvioDTE_v10.xsd");
  const setDte = addDefaultNamespace(extractElement(envioFile.xml, "SetDTE"), "SetDTE");
  if (!verifyXmlDsigFromFinalBytes(setDte, extractLastSignature(envioFile.xml))) fail("XMLDSig SetDTE final bytes no verifica");
  writeAuditManifest(outputDir, allFiles);

  return {
    environment: "certification",
    fixtureMode: true,
    encoding: "ISO-8859-1",
    bom: "absent",
    unsupportedCharacters: 0,
    accentRoundTrip: "ok",
    xmlEntities: "ok",
    cafPreserved: "8/8",
    tedFrmtFinalBytes: "8/8",
    dteSignaturesFinalBytes: "8/8",
    envelopeSignatureFinalBytes: "valid",
    dteXsdFinalBytes: "8/8",
    envioDteXsdFinalBytes: "valid",
    realCaf: false,
    siiContacted: false,
    readyToDownloadCaf: false,
  };
}

export function formatFacturaEncodingAuditResult(result: FacturaEncodingAuditResult): string {
  return [
    `environment=${result.environment}`,
    `fixtureMode=${result.fixtureMode}`,
    `encoding=${result.encoding}`,
    `bom=${result.bom}`,
    `unsupportedCharacters=${result.unsupportedCharacters}`,
    `accentRoundTrip=${result.accentRoundTrip}`,
    `xmlEntities=${result.xmlEntities}`,
    `cafPreserved=${result.cafPreserved}`,
    `tedFrmtFinalBytes=${result.tedFrmtFinalBytes}`,
    `dteSignaturesFinalBytes=${result.dteSignaturesFinalBytes}`,
    `envelopeSignatureFinalBytes=${result.envelopeSignatureFinalBytes}`,
    `dteXsdFinalBytes=${result.dteXsdFinalBytes}`,
    `envioDteXsdFinalBytes=${result.envioDteXsdFinalBytes}`,
    `realCaf=${result.realCaf}`,
    `siiContacted=${result.siiContacted}`,
    `readyToDownloadCaf=${result.readyToDownloadCaf}`,
  ].join("\n");
}

export function createIsolatedAuditOutputDir(): string {
  return mkdtempSync(join(tmpdir(), "citaya-pre-caf-9-audit-"));
}

export function writeLatin1FixtureFileForAudit(path: string, xml: string): void {
  writeFileSync(path, encodeIso88591Strict(xml));
  chmodSync(path, 0o600);
}
