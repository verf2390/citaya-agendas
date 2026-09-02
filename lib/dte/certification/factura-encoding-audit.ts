import { createHash, createPublicKey, createVerify } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { PRE_CAF_REQUIRED_CASE_ORDER, validatePreCafExternalData } from "./pre-caf-external-contract";
import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";
import {
  encodeIso88591Strict,
  FACTURA_SET_FIXTURE_OUTPUT_DIR,
  runFacturaSetDryRun,
  type FacturaSetDryRunOptions,
} from "./factura-set-dry-run";

function artifactNames(fixtureMode: boolean) {
  const suffix = fixtureMode ? "FIXTURE-SIN-VALIDEZ" : "CERTIFICATION";
  return {
    dteFiles: PRE_CAF_REQUIRED_CASE_ORDER.map((caseId) => `${caseId}-DTE-${suffix}.xml`),
    envioFile: `EnvioDTE-4959698-${suffix}.xml`,
    manifestFile: `manifest-4959698-${suffix}.json`,
    auditFile: `encoding-audit-4959698-${suffix}.json`,
  };
}

type ManifestFile = { file: string; sha256: string };
type FixtureManifest = { fixtureMode: true; files: ManifestFile[]; cafFixtures: Array<{ caseId: string; sha256: string }> };
type RealManifest = { fixtureMode: false; files: ManifestFile[]; cafHashes: Array<{ type: 33 | 56 | 61; sha256: string }> };
type FacturaSetManifest = FixtureManifest | RealManifest;

type AuditFile = {
  name: string;
  path: string;
  bytes: Buffer;
  xml: string;
};

export type FacturaEncodingAuditResult = {
  environment: "certification";
  fixtureMode: boolean;
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
  realCaf: boolean;
  siiContacted: false;
  readyToDownloadCaf: false;
};

export type FacturaEncodingAuditOptions = FacturaSetDryRunOptions & {
  skipGeneration?: boolean;
  outputDir?: string;
  manifestMode?: "fixture" | "real";
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

function extractReferenceId(xml: string, tag: "Documento" | "SetDTE"): string {
  const openingTag = extractElement(xml, tag).split(">")[0] + ">";
  const id = openingTag.match(/\sID="([^"]+)"/)?.[1];
  if (!id || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(id))
    fail("ID invalido o ausente: " + tag);
  return id;
}

function verifyXmlsecFinalSignature(path: string, referenceId: string): boolean {
  const xpath = "//*[local-name()=\"Signature\"][.//*[local-name()=\"Reference\" and " +
    String.fromCharCode(64) + "URI=\"#" + referenceId + "\"]]";
  return spawnSync("xmlsec1", [
    "--verify",
    "--id-attr:ID",
    "Documento",
    "--id-attr:ID",
    "SetDTE",
    "--node-xpath",
    xpath,
    path,
  ], { stdio: "ignore" }).status === 0;
}

function assertXmlsecAvailable(): void {
  if (spawnSync("xmlsec1", ["--version"], { stdio: "ignore" }).status !== 0)
    fail("xmlsec1 no disponible para auditar firmas finales");
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

function readManifest(outputDir: string, fixtureMode: boolean): FacturaSetManifest {
  const names = artifactNames(fixtureMode);
  const raw = readFileSync(join(outputDir, names.manifestFile), "utf8");
  const parsed = JSON.parse(raw) as { fixtureMode?: unknown; files?: unknown; cafFixtures?: unknown; cafHashes?: unknown };
  const has = (field: "cafFixtures" | "cafHashes") => Object.prototype.hasOwnProperty.call(parsed, field);
  if (parsed.fixtureMode !== fixtureMode) fail("stage=manifest field=fixtureMode");
  if (!Array.isArray(parsed.files) || parsed.files.length !== 9) fail("stage=manifest field=files");
  const files = parsed.files.map((item) => {
    const value = item as { file?: unknown; sha256?: unknown };
    if (typeof value.file !== "string" || !/^[a-f0-9]{64}$/.test(String(value.sha256))) fail("stage=manifest field=files");
    return { file: value.file, sha256: String(value.sha256) };
  });
  if (fixtureMode) {
    if (!has("cafFixtures") || has("cafHashes") || !Array.isArray(parsed.cafFixtures) || parsed.cafFixtures.length !== 8)
      fail("stage=manifest field=cafFixtures");
    const cafFixtures = parsed.cafFixtures.map((item) => {
      const value = item as { caseId?: unknown; sha256?: unknown };
      if (typeof value.caseId !== "string" || !/^[a-f0-9]{64}$/.test(String(value.sha256))) fail("stage=manifest field=cafFixtures");
      return { caseId: value.caseId, sha256: String(value.sha256) };
    });
    return { fixtureMode: true, files, cafFixtures };
  }
  if (!has("cafHashes") || has("cafFixtures") || !Array.isArray(parsed.cafHashes) || parsed.cafHashes.length < 3)
    fail("stage=manifest field=cafHashes");
  const cafHashes = parsed.cafHashes.map((item) => {
    const value = item as { type?: unknown; sha256?: unknown };
    if ((value.type !== 33 && value.type !== 56 && value.type !== 61) || !/^[a-f0-9]{64}$/.test(String(value.sha256)))
      fail("stage=manifest field=cafHashes");
    return { type: value.type, sha256: String(value.sha256) } as { type: 33 | 56 | 61; sha256: string };
  });
  if (new Set(cafHashes.map((item) => item.type)).size !== 3 ||
      new Set(cafHashes.map((item) => item.type + ":" + item.sha256)).size !== cafHashes.length)
    fail("stage=manifest field=cafHashes");
  return { fixtureMode: false, files, cafHashes };
}

function assertManifestHashes(outputDir: string, manifest: ReturnType<typeof readManifest>): void {
  for (const item of manifest.files) {
    if (sha256(readFileSync(join(outputDir, item.file))) !== item.sha256) fail("manifest SHA-256 no coincide con XML final");
  }
}

function writeAuditManifest(outputDir: string, files: AuditFile[], fixtureMode: boolean): void {
  const names = artifactNames(fixtureMode);
  writeFileSync(join(outputDir, names.auditFile), JSON.stringify({
    fixtureMode,
    legalValidity: fixtureMode ? "SIN_VALIDEZ_TRIBUTARIA" : "CERTIFICATION_OFFLINE_NOT_SUBMITTED",
    encoding: "ISO-8859-1",
    files: files.map((file) => ({ file: file.name, sha256: sha256(file.bytes) })),
  }, null, 2), "utf8");
  chmodSync(join(outputDir, names.auditFile), 0o600);
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
  if (env.DTE_MODE === "production" || env.DTE_SII_ENV === "production") fail("stage=environment field=production");
  if (env.DTE_MODE !== "certification" || env.DTE_SII_ENV !== "certification") fail("DTE_MODE y DTE_SII_ENV deben ser certification para PRE-CAF 9");
  if (env.DTE_CAF_PATH) fail("stage=environment field=DTE_CAF_PATH");
  if (env.DTE_CAF_PRIVATE_KEY_PATH) fail("stage=environment field=DTE_CAF_PRIVATE_KEY_PATH");
  if (env.DTE_SII_ENABLE_SUBMIT === "true" || env.DTE_TRACK_ID || env.DTE_SII_TOKEN) fail("SII submit/token/track_id bloqueado para PRE-CAF 9");
  ensureInputReady(env, repoRoot);

  const fixtureMode = options.manifestMode !== "real";
  const names = artifactNames(fixtureMode);
  const outputDir = options.outputDir ?? env.DTE_FACTURA_SET_DRY_RUN_OUTPUT_DIR ?? FACTURA_SET_FIXTURE_OUTPUT_DIR;
  if (!options.skipGeneration) {
    if (!fixtureMode) fail("stage=audit field=manifestMode");
    runFacturaSetDryRun({ ...options, outputDir, env, repoRoot });
  }

  const manifest = readManifest(outputDir, fixtureMode);
  const dteFiles = names.dteFiles.map((name) => decodeIso88591File(join(outputDir, name), name));
  const envioFile = decodeIso88591File(join(outputDir, names.envioFile), names.envioFile);
  const allFiles = [...dteFiles, envioFile];
  assertManifestHashes(outputDir, manifest);
  for (const file of allFiles) assertNoInvalidXmlCharacters(file.xml);
  if (!dteFiles.some((file) => file.xml.includes("Cajón")) || !dteFiles.some((file) => file.xml.includes("Pañuelo"))) fail("acentos esperados no hacen round-trip");
  if (!dteFiles.some((file) => file.xml.includes("Pintura B&amp;W AFECTO"))) fail("entidad XML esperada para ampersand ausente");
  if (dteFiles.some((file) => file.xml.includes("Pintura B&W AFECTO"))) fail("ampersand sin escapar detectado");

  assertXmlsecAvailable();
  let cafOk = 0;
  let frmtOk = 0;
  let literalDteSignatureOk = 0;
  let embeddedDteSignatureOk = 0;
  for (const file of dteFiles) {
    validateXsdFinal(file, "DTE_v10.xsd");
    const cafXml = extractElement(extractElement(file.xml, "DD"), "CAF");
    const cafHash = sha256(cafXml);
    const caseId = file.name.slice(0, "4959698-1".length);
    const type = Number(extractFirst(extractElement(file.xml, "Encabezado"), "TipoDTE"));
    const cafManifest = manifest.fixtureMode
      ? manifest.cafFixtures.find((item) => item.caseId === caseId)
      : manifest.cafHashes.find((item) => item.type === type && item.sha256 === cafHash);
    if (!cafManifest) fail(`stage=manifest field=${manifest.fixtureMode ? "cafFixtures" : "cafHashes"}`);
    if (cafHash === cafManifest.sha256) cafOk += 1;
    if (verifyFrmtFromFinalBytes(file.xml)) frmtOk += 1;
    assertTedMatchesDte(file.xml);
    const documentId = extractReferenceId(file.xml, "Documento");
    if (verifyXmlsecFinalSignature(file.path, documentId)) literalDteSignatureOk += 1;
    if (verifyXmlsecFinalSignature(envioFile.path, documentId)) embeddedDteSignatureOk += 1;
  }
  if (cafOk !== 8) fail(`CAF ${manifest.fixtureMode ? "fixture" : "certification"} no preservado ${cafOk}/8`);
  if (frmtOk !== 8) fail(`FRMT final bytes no verifica ${frmtOk}/8`);
  if (literalDteSignatureOk !== 8) fail(`XMLDSig DTE literal final bytes no verifica ${literalDteSignatureOk}/8`);
  if (embeddedDteSignatureOk !== 8) fail(`XMLDSig DTE embebido final bytes no verifica ${embeddedDteSignatureOk}/8`);

  validateXsdFinal(envioFile, "EnvioDTE_v10.xsd");
  const setDteId = extractReferenceId(envioFile.xml, "SetDTE");
  if (!verifyXmlsecFinalSignature(envioFile.path, setDteId)) fail("XMLDSig SetDTE final bytes no verifica");
  writeAuditManifest(outputDir, allFiles, fixtureMode);

  return {
    environment: "certification",
    fixtureMode,
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
    realCaf: !fixtureMode,
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
