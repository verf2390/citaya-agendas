import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { TaxDocumentRecipient, TenantTaxProfile } from "../types";
import { loadCafAuthorization, type ImportedCaf } from "./caf-secure-import";
import {
  runControlledCertificationSet,
  type ControlledCertificationSetResult,
} from "./factura-set-dry-run";
import { FolioSqliteLedger } from "./folio-sqlite-ledger";
import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";
import { validateCertificationReissueManifestLineage, verifyPersistedXmlsecSignatures } from "./factura-certification-set-submit";
import {
  assertCertificationSimulationDrafts,
  buildCertificationSimulationDrafts,
  CERTIFICATION_SIMULATION_CONTINGENCY,
  CERTIFICATION_SIMULATION_FOLIOS_PLAN,
  CERTIFICATION_SIMULATION_PLAN,
  selectUniqueSimulationCaf,
} from "./certification-simulation-model";

const ROOT = "/home/verf/secure/dte-lab";
const ACCEPTED_SET_DIR = ROOT + "/set-4959698-reissue-001";
const ACCEPTED_MANIFEST = ACCEPTED_SET_DIR + "/manifest-4959698-CERTIFICATION.json";
const ACCEPTED_REGISTRY = ROOT + "/submit-registry/875e311358155109761133688bdbbec1341a038cb0ebdd17290b3e711d4912a0.json";
const ACCEPTED_ENVELOPE_SHA256 = "875e311358155109761133688bdbbec1341a038cb0ebdd17290b3e711d4912a0";
const ACCEPTED_TRACK_ID = "0253277434";
const OUTPUT_DIR = ROOT + "/simulation-set-001";
const ENVELOPE_FILE = "EnvioDTE-SIMULATION-001-CERTIFICATION.xml";
const MANIFEST_FILE = "manifest-SIMULATION-001-CERTIFICATION.json";
const SET_ID = "CitayaSetDTE-SIMULATION-001-CERT";
const IDEMPOTENCY_KEY = "CERTIFICATION-SIMULATION-001";
const CAF_SPECS = [
  { typeCode: 33 as const, rangeFrom: 9, rangeTo: 16, path: ROOT + "/caf/incoming/caf-simulation-33-folios-9-16.xml", sha256: "14fa4c2d4d8b0de48edfe16f0b375145747e269b7bf0593100b80f1aa058d768" },
  { typeCode: 56 as const, rangeFrom: 3, rangeTo: 4, path: ROOT + "/caf/incoming/caf-simulation-56-folio-3.xml", sha256: "cd5b33fd5604ac91762aa5275f369b3abab000a99a3c96601b5b7418b900d40e" },
  { typeCode: 61 as const, rangeFrom: 7, rangeTo: 12, path: ROOT + "/caf/incoming/caf-simulation-61-folio-7.xml", sha256: "2cc76903dc3d1bec413b14e9c6f97182b6bf817149aa94cc7d2a02b388ac47c6" },
] as const;

function reject(field: string, cause?: unknown): never {
  const error = new Error("CERTIFICATION_SIMULATION_REJECTED field=" + field);
  (error as Error & { cause?: unknown }).cause = cause;
  throw error;
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) reject(name.toLowerCase());
  return value;
}
function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep));
}
function externalFile(path: string, repoRoot: string, field: string): string {
  const target = resolve(path);
  try {
    const stat = lstatSync(target);
    if (!isAbsolute(path) || inside(repoRoot, target) || !stat.isFile() || stat.isSymbolicLink() || realpathSync(target) !== target || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600) reject(field);
  } catch (error) { reject(field, error); }
  return target;
}
function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
function xmlText(xml: string, name: string): string {
  return xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([^<]*)</" + name + ">"))?.[1]?.trim() ?? reject("accepted_" + name);
}
function fileSnapshot(path: string): { path: string; sha256: string } {
  return { path, sha256: sha256(readFileSync(path)) };
}
function directorySnapshot(path: string): { fingerprint: string; files: Array<{ file: string; sha256: string }> } {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path || (stat.mode & 0o777) !== 0o700) reject("snapshot");
  const files = readdirSync(path).sort().map((file) => fileSnapshot(join(path, file))).map((item) => ({ file: basename(item.path), sha256: item.sha256 }));
  return { fingerprint: sha256(JSON.stringify(files)), files };
}
function snapshotMatches(snapshot: ReturnType<typeof directorySnapshot>, path: string): boolean {
  return JSON.stringify(snapshot) === JSON.stringify(directorySnapshot(path));
}
function assertEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.DTE_MODE !== "certification" || env.DTE_SII_ENV !== "certification" || env.NODE_ENV === "production") reject("environment");
  if (env.DTE_SII_LIVE_AUTH === "true" || env.DTE_SII_ENABLE_SUBMIT === "true" || env.DTE_SII_ENABLE_STATUS === "true" || env.DTE_SII_TOKEN || env.DTE_TRACK_ID) reject("external_operations");
  if (env.DTE_SIMULATION_PREPARE_CONFIRM !== "PREPARE_CERTIFICATION_SIMULATION_001_OFFLINE") reject("confirmation");
}
function loadAcceptedIdentity(env: NodeJS.ProcessEnv, repoRoot: string, issueDate: string): { issuer: TenantTaxProfile; recipients: TaxDocumentRecipient[]; rutEnvia: string; manifestSha256: string; registrySha256: string } {
  externalFile(ACCEPTED_MANIFEST, repoRoot, "accepted_manifest");
  externalFile(ACCEPTED_REGISTRY, repoRoot, "accepted_registry");
  const manifestBytes = readFileSync(ACCEPTED_MANIFEST);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
  if (!validateCertificationReissueManifestLineage(manifest) || manifest.envelopeSha256 !== ACCEPTED_ENVELOPE_SHA256) reject("accepted_lineage");
  const registryBytes = readFileSync(ACCEPTED_REGISTRY);
  const registry = JSON.parse(registryBytes.toString("utf8")) as Record<string, unknown>;
  if (registry.state !== "submitted" || registry.envelopeSha256 !== ACCEPTED_ENVELOPE_SHA256 || registry.trackId !== ACCEPTED_TRACK_ID) reject("accepted_registry");
  const files = new Map((manifest.files as Array<Record<string, unknown>>).map((entry) => [String(entry.file), String(entry.sha256)]));
  const recipients: TaxDocumentRecipient[] = [];
  let acceptedIssuer = "";
  for (let index = 1; index <= 4; index += 1) {
    const name = "4959698-" + index + "-DTE-CERTIFICATION.xml";
    const path = join(ACCEPTED_SET_DIR, name);
    externalFile(path, repoRoot, "accepted_dte");
    const bytes = readFileSync(path);
    if (files.get(name) !== sha256(bytes)) reject("accepted_dte_hash");
    const xml = bytes.toString("latin1");
    acceptedIssuer = acceptedIssuer || xmlText(xml, "RUTEmisor");
    if (xmlText(xml, "RUTEmisor") !== acceptedIssuer || xmlText(xml, "TipoDTE") !== "33") reject("accepted_dte_identity");
    recipients.push({
      rut: xmlText(xml, "RUTRecep"),
      legalName: xmlText(xml, "RznSocRecep"),
      businessActivity: xmlText(xml, "GiroRecep"),
      address: xmlText(xml, "DirRecep"),
      commune: xmlText(xml, "CmnaRecep"),
      city: xmlText(xml, "CiudadRecep"),
      email: "certificacion@example.invalid",
    });
  }
  const loaded = loadFacturaPreCafInputFromPath({ inputPath: required(env, "DTE_FACTURA_PRE_CAF_INPUT_PATH"), repoRoot, env: { ...env, DTE_FACTURA_PRE_CAF_ISSUE_DATE: issueDate } });
  if (!loaded.ok || !loaded.input.issuer || loaded.input.issuer.rutEmisor !== acceptedIssuer) reject("external_contract");
  const value = loaded.input.issuer;
  const issuer: TenantTaxProfile = {
    tenantId: "citaya-certification-simulation-001",
    rut: String(value.rutEmisor), legalName: String(value.razonSocial), businessActivity: String(value.giroEmisor),
    businessActivityCode: String(value.acteco), address: String(value.direccionOrigen), commune: String(value.comunaOrigen), city: String(value.ciudadOrigen),
    siiResolutionDate: String(value.fechaResolucion), siiResolutionNumber: String(value.numeroResolucion), dteEnvironment: "certification",
  };
  return { issuer, recipients, rutEnvia: String(value.rutEnvia), manifestSha256: sha256(manifestBytes), registrySha256: sha256(registryBytes) };
}

export function auditCertificationSimulationCafs(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): readonly ImportedCaf[] {
  assertEnvironment(env);
  if (env.DTE_ALLOW_REAL_CAF_AUDIT !== "true" || env.DTE_ALLOW_MANUAL_CAF_PROVENANCE !== "true" || env.DTE_CAF_MANUAL_PROVENANCE_CONFIRM !== "MAULLIN_CERTIFICATION_DOWNLOAD_REVIEWED") reject("caf_audit_confirmation");
  const issueDate = required(env, "DTE_SIMULATION_ISSUE_DATE");
  const identity = loadAcceptedIdentity(env, repoRoot, issueDate);
  const owner = process.getuid?.();
  if (owner === undefined) reject("owner");
  const cafs = CAF_SPECS.map((spec) => loadCafAuthorization(spec.path, {
    repoRoot, expectedIssuerRut: identity.issuer.rut, expectedType: spec.typeCode, expectedRange: { from: spec.rangeFrom, to: spec.rangeTo }, expectedIdk: "100",
    minimumAvailable: spec.rangeTo - spec.rangeFrom + 1, expectedSha256: spec.sha256, expectedOwnerUid: owner,
    trustStore: new Map(), fixtureMode: false, materialKind: "certification_real", allowPendingOfficialTrustAnchor: true,
  }));
  if (new Set(cafs.map((caf) => caf.logicalIdentity)).size !== 3 || cafs.some((caf) => caf.authorizationDate > issueDate || caf.trustStatus !== "pending_official" || !caf.originalBytes.equals(Buffer.from(caf.originalXml, "latin1")))) reject("caf_contract");
  for (const item of CERTIFICATION_SIMULATION_PLAN) selectUniqueSimulationCaf(cafs, item.typeCode, item.folio);
  return cafs;
}

export function resolveCertificationSimulationFolioPlan(ledger: FolioSqliteLedger, issuer: string, idempotencyKey = IDEMPOTENCY_KEY): { reused: boolean; folios: Record<string, number> } {
  const rows = CERTIFICATION_SIMULATION_PLAN.map((item) => ({ item, row: ledger.db.prepare("SELECT type_code,folio,state FROM folios WHERE issuer=? AND reserved_case=?").get(issuer, idempotencyKey + ":" + item.caseId) as { type_code: number; folio: number; state: string } | undefined }));
  const existing = rows.filter((entry) => entry.row);
  if (existing.length) {
    if (existing.length !== rows.length || rows.some(({ item, row }) => !row || row.type_code !== item.typeCode || row.folio !== item.folio || row.state !== "reserved")) reject("reservation_reuse");
    return { reused: true, folios: Object.fromEntries(rows.map(({ item }) => [item.caseId, item.folio])) };
  }
  const allocated = ledger.reservePlan(issuer, CERTIFICATION_SIMULATION_PLAN.map((item) => ({ caseId: idempotencyKey + ":" + item.caseId, typeCode: item.typeCode })));
  const folios = Object.fromEntries(CERTIFICATION_SIMULATION_PLAN.map((item) => [item.caseId, allocated[idempotencyKey + ":" + item.caseId]]));
  if (CERTIFICATION_SIMULATION_PLAN.some((item) => folios[item.caseId] !== item.folio)) reject("folio_plan");
  return { reused: false, folios };
}
function assertContingency(ledger: FolioSqliteLedger, issuer: string): void {
  for (const [typeCode, folio] of [[56, 4], [61, 8], [61, 9], [61, 10], [61, 11], [61, 12]] as const) {
    const row = ledger.db.prepare("SELECT state FROM folios WHERE issuer=? AND type_code=? AND folio=?").get(issuer, typeCode, folio) as { state: string } | undefined;
    if (row?.state !== "available") reject("contingency");
  }
}
function xmlsecStandalone(path: string, certPath: string): boolean {
  return spawnSync("xmlsec1", ["--verify", "--id-attr:ID", "Documento", "--pubkey-cert-pem", certPath, path], { stdio: "ignore" }).status === 0;
}
function maxBase64LineLength(xml: string): number {
  return Math.max(0, ...[...xml.matchAll(/<(?:SignatureValue|X509Certificate|FRMT)[^>]*>([\\s\\S]*?)<\//g)].flatMap((match) => match[1].split(/\\r?\\n/).map((line) => line.trim().length)));
}
function validateGenerated(outputDir: string, certPath: string, result: ControlledCertificationSetResult): { literal: number; embedded: number; outer: boolean; xsi: number } {
  const envelope = readFileSync(result.envelopePath);
  const xml = envelope.toString("latin1");
  const paths = CERTIFICATION_SIMULATION_PLAN.map((item) => join(outputDir, item.caseId + "-DTE-CERTIFICATION.xml"));
  const gate = verifyPersistedXmlsecSignatures({ envelopePath: result.envelopePath, bytes: envelope, expectedSha256: result.envelopeSha256, certificatePath: certPath });
  const literal = paths.filter((path) => xmlsecStandalone(path, certPath)).length;
  const xsi = paths.filter((path) => /<DTE\b[^>]*\bxmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"/.test(readFileSync(path, "latin1"))).length;
  if (result.documents !== 10 || result.type33 !== 8 || result.type56 !== 1 || result.type61 !== 1 || result.tedFrmt !== "10/10" || result.dteXsd !== "10/10" || result.cafCoverageUnique !== "10/10" || literal !== 10 || gate.individualValid !== 10 || !gate.outerValid || !gate.persistedBytesValid || xsi !== 10 || maxBase64LineLength(xml) > 76 || envelope.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || !xml.startsWith("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>") || !Buffer.from(xml, "latin1").equals(envelope)) reject("cryptographic_gates");
  return { literal, embedded: gate.individualValid, outer: gate.outerValid, xsi };
}

export type CertificationSimulationPrepareResult = {
  simulationPrepared: true; artifactKind: "certification_simulation_set"; simulationNumber: 1; documents: 10; foliosPlan: typeof CERTIFICATION_SIMULATION_FOLIOS_PLAN;
  cafCoverageUnique: "10/10"; officialFrmtValid: "10/10"; xsiPhysicallyDeclaredOnDte: "10/10"; literalStandaloneXmlsecValid: "10/10"; embeddedXmlsecValid: "10/10";
  outerXmlsecValid: true; dteXsd: "10/10"; envioDteXsd: "valid"; references: "valid"; totals: "valid"; encoding: "ISO-8859-1"; bom: "absent";
  contingencyAvailable: typeof CERTIFICATION_SIMULATION_CONTINGENCY; previousArtifactsUnchanged: true; previousRegistriesUnchanged: true; previousLedgerEntriesUnchanged: true;
  envelopePath: string; envelopeSha256: string; manifestPath: string; reservationReused: boolean; siiContacted: false; submitted: false; statusQueried: false;
};

export function prepareCertificationSimulationSet(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): CertificationSimulationPrepareResult {
  assertEnvironment(env);
  const issueDate = required(env, "DTE_SIMULATION_ISSUE_DATE");
  const outputDir = resolve(env.DTE_SIMULATION_OUTPUT_DIR || OUTPUT_DIR);
  if (outputDir !== OUTPUT_DIR || (existsSync(outputDir) && readdirSync(outputDir).length > 0)) reject("output");
  const ledgerPath = externalFile(required(env, "DTE_FACTURA_CERTIFICATION_LEDGER_PATH"), repoRoot, "ledger");
  const certPath = externalFile(required(env, "DTE_CERT_PATH"), repoRoot, "certificate");
  const keyPath = externalFile(required(env, "DTE_PRIVATE_KEY_PATH"), repoRoot, "private_key");
  const acceptedBefore = directorySnapshot(ACCEPTED_SET_DIR);
  const registryBefore = fileSnapshot(ACCEPTED_REGISTRY);
  const identity = loadAcceptedIdentity(env, repoRoot, issueDate);
  const drafts = buildCertificationSimulationDrafts({ ...identity, issueDate });
  assertCertificationSimulationDrafts(drafts);
  const cafs = auditCertificationSimulationCafs(env, repoRoot);
  const ledger = new FolioSqliteLedger(ledgerPath);
  try {
    const previousFolios = ledger.db.prepare("SELECT issuer,type_code,folio,caf_id,state,reserved_case,reserved_at,lease_expires_at,issued_at FROM folios WHERE NOT ((type_code=33 AND folio BETWEEN 9 AND 16) OR (type_code=56 AND folio BETWEEN 3 AND 4) OR (type_code=61 AND folio BETWEEN 7 AND 12)) ORDER BY issuer,type_code,folio").all() as Array<Record<string, unknown>>;
    if (previousFolios.length !== 16 || previousFolios.some((row) => row.state !== "issued")) reject("previous_ledger");
    const existingImports = new Set((ledger.db.prepare("SELECT content_sha256 FROM caf_imports").all() as Array<{ content_sha256: string }>).map((row) => row.content_sha256));
    const missing = cafs.filter((caf) => !existingImports.has(caf.sha256));
    if (![0, 3].includes(missing.length)) reject("new_caf_ranges");
    missing.forEach((caf) => ledger.importCaf(caf));
    const plan = resolveCertificationSimulationFolioPlan(ledger, identity.issuer.rut);
    assertContingency(ledger, identity.issuer.rut);
    mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    chmodSync(outputDir, 0o700);
    const generation = runControlledCertificationSet({
      env: { ...env, DTE_CAF_PATH: undefined, DTE_CAF_PRIVATE_KEY_PATH: undefined }, outputDir, signingMaterial: { privateKeyPath: keyPath, certificatePath: certPath }, drafts,
      caseIds: CERTIFICATION_SIMULATION_PLAN.map((item) => item.caseId), rutEnvia: identity.rutEnvia,
      importedCafs: cafs.map((caf) => ({ typeCode: caf.typeCode as 33 | 56 | 61, rangeFrom: caf.rangeFrom, rangeTo: caf.rangeTo, cafXml: caf.cafXml, privateKeyPem: caf.privateKeyPem, publicKeyPem: caf.publicKeyPem, sha256: caf.sha256 })),
      setDteId: SET_ID, envelopeFileName: ENVELOPE_FILE, manifestFileName: MANIFEST_FILE,
      generationTimestamp: issueDate + "T12:00:00",
      manifestMetadata: {
        schemaVersion: 1, artifactKind: "certification_simulation_set", simulationNumber: 1, documentsCount: 10,
        foliosPlan: CERTIFICATION_SIMULATION_FOLIOS_PLAN, folios: { "33": [9,10,11,12,13,14,15,16], "56": [3], "61": [7] },
        contingencyAvailable: CERTIFICATION_SIMULATION_CONTINGENCY, lineage: { artifactKind: "certification_set_reissue", envelopeSha256: ACCEPTED_ENVELOPE_SHA256, manifestSha256: identity.manifestSha256, registrySha256: identity.registrySha256, trackIdFingerprint: sha256(ACCEPTED_TRACK_ID).slice(0,16), portalStage: "SIMULACION" },
        previousArtifactSnapshotSha256: acceptedBefore.fingerprint, previousRegistrySnapshotSha256: registryBefore.sha256,
        previousArtifactsUnchanged: true, previousRegistriesUnchanged: true, previousLedgerEntriesUnchanged: true,
      },
    });
    const cryptographic = validateGenerated(outputDir, certPath, generation);
    if (!snapshotMatches(acceptedBefore, ACCEPTED_SET_DIR) || sha256(readFileSync(ACCEPTED_REGISTRY)) !== registryBefore.sha256) reject("append_only");
    const afterPrevious = previousFolios.map((before) => ledger.db.prepare("SELECT issuer,type_code,folio,caf_id,state,reserved_case,reserved_at,lease_expires_at,issued_at FROM folios WHERE issuer=? AND type_code=? AND folio=?").get(before.issuer, before.type_code, before.folio));
    if (JSON.stringify(afterPrevious) !== JSON.stringify(previousFolios)) reject("previous_ledger_changed");
    const manifest = JSON.parse(readFileSync(generation.manifestPath, "utf8")) as Record<string, unknown>;
    Object.assign(manifest, {
      envelopeSha256: generation.envelopeSha256, officialFrmtValid: "10/10", xsiPhysicallyDeclaredOnDte: cryptographic.xsi + "/10",
      literalStandaloneXmlsecValid: cryptographic.literal + "/10", embeddedXmlsecValid: cryptographic.embedded + "/10", outerXmlsecValid: cryptographic.outer,
      dteXsd: "10/10", envioDteXsd: "valid", references: "valid", totals: "valid", encoding: "ISO-8859-1", bom: "absent",
    });
    writeFileSync(generation.manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    chmodSync(generation.manifestPath, 0o600);
    ledger.markPlanIssued(identity.issuer.rut, CERTIFICATION_SIMULATION_PLAN.map((item) => IDEMPOTENCY_KEY + ":" + item.caseId));
    assertContingency(ledger, identity.issuer.rut);
    const states = ledger.db.prepare("SELECT type_code,folio,state FROM folios WHERE issuer=?").all(identity.issuer.rut) as Array<{ type_code: number; folio: number; state: string }>;
    if (states.filter((row) => row.state === "issued").length !== 26 || states.filter((row) => row.state === "available").length !== 6 || states.some((row) => row.state === "reserved")) reject("ledger_finalize");
    return {
      simulationPrepared: true, artifactKind: "certification_simulation_set", simulationNumber: 1, documents: 10, foliosPlan: CERTIFICATION_SIMULATION_FOLIOS_PLAN,
      cafCoverageUnique: "10/10", officialFrmtValid: "10/10", xsiPhysicallyDeclaredOnDte: "10/10", literalStandaloneXmlsecValid: "10/10", embeddedXmlsecValid: "10/10",
      outerXmlsecValid: true, dteXsd: "10/10", envioDteXsd: "valid", references: "valid", totals: "valid", encoding: "ISO-8859-1", bom: "absent",
      contingencyAvailable: CERTIFICATION_SIMULATION_CONTINGENCY, previousArtifactsUnchanged: true, previousRegistriesUnchanged: true, previousLedgerEntriesUnchanged: true,
      envelopePath: generation.envelopePath, envelopeSha256: generation.envelopeSha256, manifestPath: generation.manifestPath, reservationReused: plan.reused,
      siiContacted: false, submitted: false, statusQueried: false,
    };
  } finally { ledger.close(); }
}

export function formatCertificationSimulationPrepare(result: CertificationSimulationPrepareResult): string {
  return Object.entries(result).filter(([key]) => !["envelopePath", "manifestPath"].includes(key)).map(([key, value]) => key + "=" + value).join("\n");
}
