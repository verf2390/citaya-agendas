import Database from "better-sqlite3";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createVerify,
  X509Certificate,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawnSync } from "node:child_process";
import { DOMParser } from "@xmldom/xmldom";
import { validateRut } from "../rut";
import { canonicalizeXmlControlled } from "../signing/sign-xml.real";
import { hasRequiredSiiEnvioDteHeader } from "../xml/sii-envio-dte-header";
import {
  requestSeed,
  requestToken,
  signSeed,
  SII_CERTIFICATION_SEED_URL,
  SII_CERTIFICATION_TOKEN_URL,
} from "../sii/sii-auth";
import type { SiiCertificationConfig } from "../sii/sii-types";

export const SET_SUBMIT_URL = "https://maullin.sii.cl/cgi_dte/UPL/DTEUpload";
export const SET_SHA256 =
  "da3875da0dd1190fe290393f063e02f31d3be583454e349387f24dff59196e37";
const CORRECTION_001_ENVELOPE_SHA256 =
  "738197d2ab1d65c0f83d35b97408331114c5617cc6647768cb95dcfedc779ec3";
const CORRECTION_001_TRACK_FINGERPRINT = "0430bc27374b80a4";
const CORRECTION_002_ENVELOPE_SHA256 = "fc9a2a5836c8e93d0c6f26bf405d9ddb7db8b86b5d50d90c3ffeccc26ee62094";
const CORRECTION_002_TRACK_FINGERPRINT = "13fdc74f20f65666";
const CORRECTION_003_ENVELOPE_SHA256 = "3792002081b8f884bc0f14f3ca78ff2340fe312f7fb43dfb3f311c2cce5ae51a";
const CORRECTION_003_TRACK_FINGERPRINT = "77a28038d28ccc1e";
const REISSUE_PREVIOUS_ENVELOPE_SHA256 = "e8bfb70eb4113c0be7583c76414919ef7044cee944e2d14e52fb12d1e1f8240a";
const REISSUE_PREVIOUS_MANIFEST_SHA256 = "c11e5a0f196dcb83ec91b7648ec8ce4192956356584e74f24a1f9920b3c1f765";
const REISSUE_PREVIOUS_REGISTRY_SHA256 = "94d8647cd04b5414cb8d923458e9bf95c508de9eeae7f0bdb9ca59268a6e07ef";
const REISSUE_PREVIOUS_TRACK_FINGERPRINT = "f3bc8d8c157d4b83";
export function validateCertificationReissueManifestLineage(
  manifest: Record<string, unknown>,
): boolean {
  const assignments = Array.isArray(manifest.cafAssignments)
    ? (manifest.cafAssignments as Array<Record<string, unknown>>)
    : [];
  const expected = new Map([
    ["33:5", "1-5"], ["33:6", "6-8"], ["33:7", "6-8"], ["33:8", "6-8"],
    ["61:4", "1-4"], ["61:5", "5-6"], ["61:6", "5-6"], ["56:2", "1-2"],
  ]);
  const keys = new Set(assignments.map((item) => String(item.dteTypeFolio ?? "")));
  return (
    manifest.artifactKind === "certification_set_reissue" &&
    manifest.reissueNumber === 1 &&
    manifest.reissueReasonCode === "TED-2-510" &&
    manifest.reissueOfEnvelopeSha256 === REISSUE_PREVIOUS_ENVELOPE_SHA256 &&
    manifest.reissueOfManifestSha256 === REISSUE_PREVIOUS_MANIFEST_SHA256 &&
    manifest.reissueOfRegistrySha256 === REISSUE_PREVIOUS_REGISTRY_SHA256 &&
    manifest.reissueOfTrackIdFingerprint === REISSUE_PREVIOUS_TRACK_FINGERPRINT &&
    manifest.reissueOfStatus === "EPR" &&
    manifest.foliosPlan === "33:5-8,61:4-6,56:2" &&
    JSON.stringify(manifest.folios) === JSON.stringify({ "33": [5, 6, 7, 8], "56": [2], "61": [4, 5, 6] }) &&
    manifest.cafCoverageUnique === "8/8" &&
    assignments.length === 8 &&
    keys.size === 8 &&
    assignments.every((item) => expected.get(String(item.dteTypeFolio ?? "")) === item.range) &&
    Array.isArray(manifest.cafHashes) &&
    manifest.cafHashes.length === 5 &&
    manifest.officialFrmtValid === "8/8" &&
    manifest.xsiPhysicallyDeclaredOnDte === "8/8" &&
    manifest.literalStandaloneXmlsecValid === "8/8" &&
    manifest.embeddedXmlsecValid === "8/8" &&
    manifest.outerXmlsecValid === true &&
    manifest.dteXsd === "8/8" &&
    manifest.envioDteXsd === "valid" &&
    manifest.references === "valid" &&
    manifest.totals === "valid" &&
    manifest.encoding === "ISO-8859-1" &&
    manifest.bom === "absent" &&
    manifest.previousArtifactsUnchanged === true &&
    manifest.previousRegistriesUnchanged === true
  );
}

export type SubmitStage =
  | "preflight"
  | "envelope"
  | "certificate"
  | "manifest"
  | "ledger"
  | "registry"
  | "seed"
  | "token"
  | "submit";
export class ControlledSetSubmitError extends Error {
  readonly code = "CERTIFICATION_SET_SUBMIT_REJECTED";
  constructor(
    readonly stage: SubmitStage,
    readonly field: string,
    readonly internalCause?: unknown,
  ) {
    super("Controlled certification submit failed");
    this.name = "ControlledSetSubmitError";
  }
}
function reject(stage: SubmitStage, field: string, cause?: unknown): never {
  throw new ControlledSetSubmitError(
    stage,
    /^[a-z0-9_.-]+$/i.test(field) ? field : "internal",
    cause,
  );
}
function wrap(
  error: unknown,
  stage: SubmitStage,
  field: string,
): ControlledSetSubmitError {
  return error instanceof ControlledSetSubmitError
    ? error
    : new ControlledSetSubmitError(stage, field, error);
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) reject("preflight", name.toLowerCase());
  return value;
}
function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}
function external(env: NodeJS.ProcessEnv, name: string, root: string): string {
  const value = required(env, name);
  if (!isAbsolute(value) || inside(root, value))
    reject("preflight", name.toLowerCase());
  return resolve(value);
}
function secureFile(
  path: string,
  root: string,
  stage: SubmitStage,
  field: string,
): void {
  try {
    const st = lstatSync(path);
    if (
      inside(root, path) ||
      !st.isFile() ||
      st.isSymbolicLink() ||
      realpathSync(path) !== path ||
      st.uid !== process.getuid?.() ||
      (st.mode & 0o777) !== 0o600
    )
      reject(stage, field);
  } catch (error) {
    throw wrap(error, stage, field);
  }
}
function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
function splitRut(value: string): { rut: string; dv: string } {
  const normalized = value.replace(/\./g, "").toUpperCase();
  const match = normalized.match(/^(\d+)-([0-9K])$/);
  if (!match || !validateRut(normalized)) reject("preflight", "rut");
  return { rut: match[1], dv: match[2] };
}
function validateEndpoint(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    reject("preflight", "endpoint", error);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "maullin.sii.cl" ||
    url.pathname !== "/cgi_dte/UPL/DTEUpload" ||
    url.search ||
    url.hash
  )
    reject("preflight", "endpoint");
}
function verifyCertificatePair(certPath: string, keyPath: string): void {
  try {
    const cert = createPublicKey(readFileSync(certPath, "utf8")).export({
      type: "spki",
      format: "der",
    });
    const key = createPublicKey(
      createPrivateKey(readFileSync(keyPath, "utf8")),
    ).export({ type: "spki", format: "der" });
    if (!Buffer.from(cert).equals(Buffer.from(key)))
      reject("certificate", "key_pair");
  } catch (error) {
    throw wrap(error, "certificate", "key_pair");
  }
}
export type PersistedSignatureDiagnostics = {
  finalBytesRoundTrip: boolean;
  referenceDigestValid: boolean;
  signedInfoSignatureValid: boolean;
  embeddedCertificatePresent: boolean;
  embeddedCertificateMatchesExternal: boolean;
  externalCertificateKeyMatch: boolean;
  signatureAlgorithmAllowed: boolean;
  canonicalizationAlgorithmAllowed: boolean;
  valid: boolean;
};
function xmlTag(source: string, name: string): string | null {
  return (
    source
      .match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1]
      ?.trim() ?? null
  );
}
export function diagnosePersistedXmlSignature(
  bytes: Buffer,
  certificatePem: string,
  targetTag = "SetDTE",
): PersistedSignatureDiagnostics {
  const xml = bytes.toString("latin1");
  const finalBytesRoundTrip = Buffer.from(xml, "latin1").equals(bytes);
  const target =
    xml.match(
      new RegExp(`<${targetTag}\\b[^>]*>[\\s\\S]*?<\\/${targetTag}>`),
    )?.[0] ?? "";
  const targetId = target.match(/\sID="([^"]+)"/)?.[1] ?? "";
  const signatures = [
    ...xml.matchAll(/<Signature\b[^>]*>[\s\S]*?<\/Signature>/g),
  ].map((match) => match[0]);
  const signatureXml =
    signatures.find((value) =>
      value.includes(`<Reference URI="#${targetId}"`),
    ) ?? "";
  const digestValue = xmlTag(signatureXml, "DigestValue");
  const signatureValue = xmlTag(signatureXml, "SignatureValue");
  const embeddedCertificate = xmlTag(signatureXml, "X509Certificate");
  const signatureAlgorithm =
    signatureXml.match(/<SignatureMethod[^>]*Algorithm="([^"]+)"/)?.[1] ?? "";
  const canonicalizationAlgorithm =
    signatureXml.match(
      /<CanonicalizationMethod[^>]*Algorithm="([^"]+)"/,
    )?.[1] ?? "";
  const signatureAlgorithmAllowed =
    signatureAlgorithm === "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
  const canonicalizationAlgorithmAllowed =
    canonicalizationAlgorithm ===
    "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
  let referenceXml = target;
  if (
    referenceXml &&
    !/\\sxmlns=/.test(referenceXml.slice(0, referenceXml.indexOf(">")))
  )
    referenceXml = referenceXml.replace(
      `<${targetTag} `,
      `<${targetTag} xmlns="http://www.sii.cl/SiiDte" `,
    );
  const canonicalReference = canonicalizeXmlControlled(referenceXml);
  const referenceDigestValid = Boolean(
    canonicalReference.ok &&
    digestValue &&
    createHash("sha1")
      .update(canonicalReference.ok ? canonicalReference.canonicalXml : "")
      .digest("base64") === digestValue,
  );
  let signedInfoXml =
    signatureXml.match(/<SignedInfo\b[^>]*>[\s\S]*?<\/SignedInfo>/)?.[0] ?? "";
  if (
    signedInfoXml &&
    !/\\sxmlns=/.test(signedInfoXml.slice(0, signedInfoXml.indexOf(">")))
  )
    signedInfoXml = signedInfoXml.replace(
      "<SignedInfo>",
      '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">',
    );
  const canonicalSignedInfo = canonicalizeXmlControlled(signedInfoXml);
  let signedInfoSignatureValid = false;
  if (canonicalSignedInfo.ok && signatureValue) {
    const verifier = createVerify("RSA-SHA1");
    verifier.update(canonicalSignedInfo.canonicalXml, "utf8");
    signedInfoSignatureValid = verifier.verify(
      certificatePem,
      signatureValue,
      "base64",
    );
  }
  let externalCertificate = "";
  try {
    externalCertificate = new X509Certificate(certificatePem).raw.toString(
      "base64",
    );
  } catch {
    externalCertificate = "";
  }
  const embeddedCertificatePresent = Boolean(embeddedCertificate);
  const embeddedCertificateMatchesExternal = Boolean(
    embeddedCertificate &&
    externalCertificate &&
    embeddedCertificate.replace(/\s/g, "") === externalCertificate,
  );
  let externalCertificateKeyMatch = false;
  try {
    const embeddedKey = createPublicKey(
      `-----BEGIN CERTIFICATE-----\n${embeddedCertificate}\n-----END CERTIFICATE-----`,
    ).export({ type: "spki", format: "der" });
    const externalKey = createPublicKey(certificatePem).export({
      type: "spki",
      format: "der",
    });
    externalCertificateKeyMatch = Buffer.from(embeddedKey).equals(
      Buffer.from(externalKey),
    );
  } catch {
    externalCertificateKeyMatch = false;
  }
  const valid =
    finalBytesRoundTrip &&
    referenceDigestValid &&
    signedInfoSignatureValid &&
    embeddedCertificatePresent &&
    embeddedCertificateMatchesExternal &&
    externalCertificateKeyMatch &&
    signatureAlgorithmAllowed &&
    canonicalizationAlgorithmAllowed;
  return {
    finalBytesRoundTrip,
    referenceDigestValid,
    signedInfoSignatureValid,
    embeddedCertificatePresent,
    embeddedCertificateMatchesExternal,
    externalCertificateKeyMatch,
    signatureAlgorithmAllowed,
    canonicalizationAlgorithmAllowed,
    valid,
  };
}
export type XmlsecSignatureGate = { xmlsecAvailable: boolean; documentIds: string[]; setDteId: string; individualValid: number; outerValid: boolean; persistedBytesValid: boolean; };
export function verifyPersistedXmlsecSignatures(input: { envelopePath: string; bytes: Buffer; expectedSha256: string; certificatePath: string }): XmlsecSignatureGate { const xml = input.bytes.toString("latin1"); const documentIds = [...xml.matchAll(/<Documento\b[^>]*\bID="([^"]+)"/g)].map((match) => match[1]); const setDteId = xml.match(/<SetDTE\b[^>]*\bID="([^"]+)"/)?.[1] ?? ""; const persisted = () => { const current = readFileSync(input.envelopePath); return current.equals(input.bytes) && sha256(current) === input.expectedSha256; }; const available = spawnSync("xmlsec1", ["--version"], { stdio: "ignore" }).status === 0; if (!available || !persisted()) return { xmlsecAvailable: available, documentIds, setDteId, individualValid: 0, outerValid: false, persistedBytesValid: false }; const verify = (id: string) => spawnSync("xmlsec1", ["--verify", "--id-attr:ID", "Documento", "--id-attr:ID", "SetDTE", "--pubkey-cert-pem", input.certificatePath, "--node-xpath", "//*[local-name()=\"Signature\"][.//*[local-name()=\"Reference\" and " + String.fromCharCode(64) + "URI=\"#" + id + "\"]]", input.envelopePath], { stdio: "ignore" }).status === 0; const individualValid = documentIds.filter(verify).length; const outerValid = Boolean(setDteId) && verify(setDteId); return { xmlsecAvailable: true, documentIds, setDteId, individualValid, outerValid, persistedBytesValid: persisted() }; }
export type PreflightDeps = {
  xsd?: (path: string) => boolean;
  expectedSha256?: string;
};
export type SetSubmitPreflight = {
  envelopePath: string;
  manifestPath: string;
  ledgerPath: string;
  registryDir: string;
  registryPath: string;
  certPath: string;
  keyPath: string;
  envelope: Buffer;
  envelopeSha256: string;
  endpoint: string;
  xmlsecAvailable: true;
  xmlsecDocumentIds: string[];
  xmlsecSetDteId: string;
  xmlsecIndividualValid: "8/8";
  xmlsecOuterValid: true;
  internalVerifier: "non_authoritative";
  signatureAuthority: "xmlsec1";
  artifactKind?: "certification_set_reissue";
  cafCoverageUnique?: "8/8";
  foliosPlan?: "33:5-8,61:4-6,56:2";
  officialFrmtValid?: "8/8";
  xsiPhysicallyDeclaredOnDte?: "8/8";
  literalStandaloneXmlsecValid?: "8/8";
  embeddedXmlsecValid?: "8/8";
  previousArtifactsUnchanged?: true;
  previousRegistriesUnchanged?: true;
  company: { rut: string; dv: string };
  sender: { rut: string; dv: string };
  config: SiiCertificationConfig;
};
function snapshotExternalDirectory(path: string, repoRoot: string, field: string): string {
  const value = resolve(path);
  try {
    const stat = lstatSync(value);
    if (
      !isAbsolute(path) ||
      inside(repoRoot, value) ||
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(value) !== value ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700
    )
      reject("manifest", field);
    const files = readdirSync(value)
      .sort()
      .map((name) => {
        const file = resolve(value, name);
        secureFile(file, repoRoot, "manifest", field);
        return { file: name, sha256: sha256(readFileSync(file)) };
      });
    return sha256(JSON.stringify(files));
  } catch (error) {
    throw wrap(error, "manifest", field);
  }
}

function preflightSetSubmit(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
  deps: PreflightDeps = {},
  retry = false,
): SetSubmitPreflight {
  if (
    env.DTE_MODE !== "certification" ||
    env.DTE_SII_ENV !== "certification" ||
    env.NODE_ENV === "production"
  )
    reject("preflight", "environment");
  if (
    env.DTE_SII_LIVE_AUTH !== "true" ||
    env.DTE_SII_ENABLE_SUBMIT !== "true" ||
    env.DTE_SII_ENABLE_STATUS !== "false"
  )
    reject("preflight", "flags");
  const expected = required(
    env,
    "DTE_FACTURA_CERTIFICATION_ENVELOPE_SHA256",
  ).toLowerCase();
  const endpoint = required(env, "DTE_SII_SUBMIT_URL");
  validateEndpoint(endpoint);
  const envelopePath = external(
    env,
    "DTE_FACTURA_CERTIFICATION_ENVELOPE_PATH",
    repoRoot,
  );
  secureFile(envelopePath, repoRoot, "envelope", "metadata");
  const manifestPath = external(
    env,
    "DTE_FACTURA_CERTIFICATION_MANIFEST_PATH",
    repoRoot,
  );
  secureFile(manifestPath, repoRoot, "manifest", "metadata");
  const ledgerPath = external(
    env,
    "DTE_FACTURA_CERTIFICATION_LEDGER_PATH",
    repoRoot,
  );
  secureFile(ledgerPath, repoRoot, "ledger", "metadata");
  const certPath = external(env, "DTE_CERT_PATH", repoRoot);
  secureFile(certPath, repoRoot, "certificate", "cert");
  const keyPath = external(env, "DTE_PRIVATE_KEY_PATH", repoRoot);
  secureFile(keyPath, repoRoot, "certificate", "key");
  verifyCertificatePair(certPath, keyPath);
  const registryDir = external(
    env,
    "DTE_FACTURA_CERTIFICATION_SUBMIT_REGISTRY_DIR",
    repoRoot,
  );
  if (existsSync(registryDir)) {
    const st = lstatSync(registryDir);
    if (
      !st.isDirectory() ||
      st.isSymbolicLink() ||
      realpathSync(registryDir) !== registryDir ||
      st.uid !== process.getuid?.() ||
      (st.mode & 0o777) !== 0o700
    )
      reject("registry", "directory");
  }
  const registryPath = resolve(
    registryDir,
    retry ? `${expected}.attempt-002.json` : `${expected}.json`,
  );
  if (retry) {
    if (!existsSync(registryDir)) reject("registry", "directory");
    const retries = readdirSync(registryDir).filter((name) =>
      name.startsWith(`${expected}.attempt-`),
    );
    if (retries.length) reject("registry", "existing_retry");
  } else if (existsSync(registryPath)) reject("registry", "existing_record");
  const envelope = readFileSync(envelopePath);
  if (sha256(envelope) !== expected) reject("envelope", "sha256");
  if (envelope[0] === 0xef && envelope[1] === 0xbb && envelope[2] === 0xbf)
    reject("envelope", "bom");
  const xml = envelope.toString("latin1");
  if (
    !xml.slice(0, 100).includes('encoding="ISO-8859-1"') ||
    !Buffer.from(xml, "latin1").equals(envelope)
  )
    reject("envelope", "encoding");
  if (!hasRequiredSiiEnvioDteHeader(xml))
    reject("envelope", "schema_header");
  const xsd =
    deps.xsd ??
    ((path) =>
      spawnSync("xmllint", ["--noout", "--schema", "EnvioDTE_v10.xsd", path], {
        cwd: resolve(repoRoot, "docs/dte-sii/xsd"),
        stdio: "ignore",
      }).status === 0);
  if (!xsd(envelopePath)) reject("envelope", "xsd");
  const certificatePem = readFileSync(certPath, "utf8");
  diagnosePersistedXmlSignature(envelope, certificatePem);
  const xmlsec = verifyPersistedXmlsecSignatures({ envelopePath, bytes: envelope, expectedSha256: expected, certificatePath: certPath });
  if (!xmlsec.xmlsecAvailable) reject("envelope", "xmlsec_unavailable");
  if (!xmlsec.persistedBytesValid) reject("envelope", "signature_bytes_changed");
  if (xmlsec.documentIds.length !== 8 || !xmlsec.setDteId || xmlsec.individualValid !== 8 || !xmlsec.outerValid) reject("envelope", "signature");
  let manifest: {
    fixtureMode?: boolean;
    files?: Array<{ file?: unknown; sha256?: unknown }>;
    envelopeSha256?: unknown;
    correctionNumber?: unknown;
    correctionOfEnvelopeSha256?: unknown;
    correctionOfManifestSha256?: unknown;
    correctionOfRegistrySha256?: unknown;
    correctionOfTrackIdFingerprint?: unknown;
    correctionOfStatus?: unknown;
    statusEvidenceSource?: unknown;
    portalObservedStatus?: unknown;
    portalObservedDate?: unknown;
    correctionReason?: unknown;
    correctionResponseSha256?: unknown;
    associationKey?: unknown;
    documentsMatched?: unknown;
    artifactKind?: unknown;
    reissueNumber?: unknown;
    reissueReasonCode?: unknown;
    reissueOfEnvelopeSha256?: unknown;
    reissueOfManifestSha256?: unknown;
    reissueOfRegistrySha256?: unknown;
    reissueOfTrackIdFingerprint?: unknown;
    reissueOfStatus?: unknown;
    foliosPlan?: unknown;
    folios?: unknown;
    cafCoverageUnique?: unknown;
    cafAssignments?: Array<Record<string, unknown>>;
    cafHashes?: Array<Record<string, unknown>>;
    officialFrmtValid?: unknown;
    xsiPhysicallyDeclaredOnDte?: unknown;
    literalStandaloneXmlsecValid?: unknown;
    embeddedXmlsecValid?: unknown;
    outerXmlsecValid?: unknown;
    dteXsd?: unknown;
    envioDteXsd?: unknown;
    references?: unknown;
    totals?: unknown;
    encoding?: unknown;
    bom?: unknown;
    previousArtifactSnapshotSha256?: unknown;
    previousRegistrySnapshotSha256?: unknown;
    previousArtifactsUnchanged?: unknown;
    previousRegistriesUnchanged?: unknown;
  };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    reject("manifest", "json", error);
  }
  const names = new Set((manifest.files ?? []).map((f) => String(f.file)));
  const cases = Array.from(
    { length: 8 },
    (_, i) => `4959698-${i + 1}-DTE-CERTIFICATION.xml`,
  );
  if (
    manifest.fixtureMode !== false ||
    basename(manifestPath) !== "manifest-4959698-CERTIFICATION.json" ||
    manifest.files?.length !== 9 ||
    !cases.every((n) => names.has(n)) ||
    !names.has(basename(envelopePath))
  )
    reject("manifest", "set_4959698");
  for (const item of manifest.files ?? []) {
    const name = String(item.file ?? "");
    if (
      !/^(?:4959698-[1-8]-DTE-CERTIFICATION|EnvioDTE-4959698-CERTIFICATION)\.xml$/.test(
        name,
      )
    )
      reject("manifest", "file_name");
    const filePath = resolve(dirname(manifestPath), name);
    secureFile(filePath, repoRoot, "manifest", "file_metadata");
    if (sha256(readFileSync(filePath)) !== String(item.sha256 ?? ""))
      reject("manifest", "file_hash");
  }
  const isReissue = manifest.artifactKind === "certification_set_reissue";
  if (isReissue) {
    if (!validateCertificationReissueManifestLineage(manifest as Record<string, unknown>)) reject("manifest", "reissue_lineage");
    const expectedAssignments = new Map([
      ["33:5", "1-5"],
      ["33:6", "6-8"],
      ["33:7", "6-8"],
      ["33:8", "6-8"],
      ["61:4", "1-4"],
      ["61:5", "5-6"],
      ["61:6", "5-6"],
      ["56:2", "1-2"],
    ]);
    const assignments = manifest.cafAssignments ?? [];
    const assignmentKeys = new Set(
      assignments.map((item) => String(item.dteTypeFolio ?? "")),
    );
    if (
      manifest.reissueNumber !== 1 ||
      manifest.reissueReasonCode !== "TED-2-510" ||
      manifest.reissueOfEnvelopeSha256 !== REISSUE_PREVIOUS_ENVELOPE_SHA256 ||
      manifest.reissueOfManifestSha256 !== REISSUE_PREVIOUS_MANIFEST_SHA256 ||
      manifest.reissueOfRegistrySha256 !== REISSUE_PREVIOUS_REGISTRY_SHA256 ||
      manifest.reissueOfTrackIdFingerprint !== REISSUE_PREVIOUS_TRACK_FINGERPRINT ||
      manifest.reissueOfStatus !== "EPR" ||
      manifest.foliosPlan !== "33:5-8,61:4-6,56:2" ||
      JSON.stringify(manifest.folios) !== JSON.stringify({ "33": [5, 6, 7, 8], "56": [2], "61": [4, 5, 6] }) ||
      manifest.cafCoverageUnique !== "8/8" ||
      assignments.length !== 8 ||
      assignmentKeys.size !== 8 ||
      assignments.some(
        (item) => expectedAssignments.get(String(item.dteTypeFolio ?? "")) !== item.range,
      ) ||
      (manifest.cafHashes ?? []).length !== 5 ||
      manifest.officialFrmtValid !== "8/8" ||
      manifest.xsiPhysicallyDeclaredOnDte !== "8/8" ||
      manifest.literalStandaloneXmlsecValid !== "8/8" ||
      manifest.embeddedXmlsecValid !== "8/8" ||
      manifest.outerXmlsecValid !== true ||
      manifest.dteXsd !== "8/8" ||
      manifest.envioDteXsd !== "valid" ||
      manifest.references !== "valid" ||
      manifest.totals !== "valid" ||
      manifest.encoding !== "ISO-8859-1" ||
      manifest.bom !== "absent" ||
      manifest.previousArtifactsUnchanged !== true ||
      manifest.previousRegistriesUnchanged !== true
    )
      reject("manifest", "reissue_lineage");
    const previousArtifactDir = external(
      env,
      "DTE_FACTURA_CERTIFICATION_REISSUE_PREVIOUS_ARTIFACT_DIR",
      repoRoot,
    );
    const previousEnvelope = resolve(previousArtifactDir, "EnvioDTE-4959698-CERTIFICATION.xml");
    const previousManifest = resolve(previousArtifactDir, "manifest-4959698-CERTIFICATION.json");
    secureFile(previousEnvelope, repoRoot, "manifest", "previous_artifacts");
    secureFile(previousManifest, repoRoot, "manifest", "previous_artifacts");
    const previousRegistry = external(
      env,
      "DTE_FACTURA_CERTIFICATION_REISSUE_PREVIOUS_REGISTRY_PATH",
      repoRoot,
    );
    secureFile(previousRegistry, repoRoot, "manifest", "previous_registry");
    const previousRegistryValue = JSON.parse(readFileSync(previousRegistry, "utf8")) as Record<string, unknown>;
    const registryDirs = required(
      env,
      "DTE_FACTURA_CERTIFICATION_REISSUE_PREVIOUS_REGISTRY_DIRS",
    )
      .split(":")
      .map((value) => value.trim())
      .filter(Boolean);
    const expectedRegistrySnapshots = Array.isArray(manifest.previousRegistrySnapshotSha256)
      ? manifest.previousRegistrySnapshotSha256.map(String)
      : [];
    if (
      sha256(readFileSync(previousEnvelope)) !== REISSUE_PREVIOUS_ENVELOPE_SHA256 ||
      sha256(readFileSync(previousManifest)) !== REISSUE_PREVIOUS_MANIFEST_SHA256 ||
      sha256(readFileSync(previousRegistry)) !== REISSUE_PREVIOUS_REGISTRY_SHA256 ||
      previousRegistryValue.envelopeSha256 !== REISSUE_PREVIOUS_ENVELOPE_SHA256 ||
      previousRegistryValue.state !== "submitted" ||
      sha256(String(previousRegistryValue.trackId ?? "")).slice(0, 16) !== REISSUE_PREVIOUS_TRACK_FINGERPRINT ||
      snapshotExternalDirectory(previousArtifactDir, repoRoot, "previous_artifacts") !== manifest.previousArtifactSnapshotSha256 ||
      registryDirs.length !== 2 ||
      expectedRegistrySnapshots.length !== 2 ||
      registryDirs.some(
        (path, index) =>
          snapshotExternalDirectory(path, repoRoot, "previous_registries") !== expectedRegistrySnapshots[index],
      )
    )
      reject("manifest", "reissue_evidence");
  }
  const correctionFields = [
    "correctionNumber",
    "correctionOfEnvelopeSha256",
    "correctionReason",
    "correctionResponseSha256",
  ] as const;
  const isCorrection = correctionFields.some((field) => field in manifest);
  const isCorrectionTwo = manifest.correctionNumber === 2;
  const isCorrectionThree = manifest.correctionNumber === 3;
  const isCorrectionFour = manifest.correctionNumber === 4;
  const envelopeArtifact = (manifest.files ?? []).find(
    (item) => String(item.file ?? "") === basename(envelopePath),
  );
  const manifestEnvelopeSha256 = String(manifest.envelopeSha256 ?? "").toLowerCase();
  const artifactSha256 = String(envelopeArtifact?.sha256 ?? "").toLowerCase();
  let controlledExpected = deps.expectedSha256 ?? SET_SHA256;
  if (isReissue) {
    if (!/^[a-f0-9]{64}$/.test(manifestEnvelopeSha256) || manifestEnvelopeSha256 !== artifactSha256 || manifestEnvelopeSha256 !== expected) reject("manifest", "reissue_envelope");
    controlledExpected = manifestEnvelopeSha256;
  } else if (isCorrectionFour) {
    if (manifest.correctionOfEnvelopeSha256 !== CORRECTION_003_ENVELOPE_SHA256 || manifest.correctionOfTrackIdFingerprint !== CORRECTION_003_TRACK_FINGERPRINT || manifest.correctionOfStatus !== "EPR" || manifest.correctionReason !== "DTE_3_505_INHERITED_XSI_NAMESPACE" || manifest.documentsMatched !== "8/8" || !/^[a-f0-9]{64}$/.test(String(manifestEnvelopeSha256)) || manifestEnvelopeSha256 !== artifactSha256 || manifestEnvelopeSha256 !== expected) reject("manifest", "correction_lineage");
    controlledExpected = manifestEnvelopeSha256;
  } else if (isCorrectionThree) {
    if (
      manifest.correctionOfEnvelopeSha256 !== CORRECTION_002_ENVELOPE_SHA256 ||
      manifest.correctionOfTrackIdFingerprint !== CORRECTION_002_TRACK_FINGERPRINT ||
      manifest.correctionOfStatus !== "RFR" ||
      manifest.correctionReason !== "RFR_DETACHED_C14N_DIGEST_MISMATCH" ||
      manifest.portalObservedDate !== "2026-07-22" ||
      !/^[a-f0-9]{64}$/.test(String(manifest.correctionOfManifestSha256 ?? "")) ||
      !/^[a-f0-9]{64}$/.test(String(manifest.correctionOfRegistrySha256 ?? "")) ||
      !/^[a-f0-9]{64}$/.test(manifestEnvelopeSha256) ||
      manifestEnvelopeSha256 !== artifactSha256 ||
      manifestEnvelopeSha256 !== expected
    )
      reject("manifest", "correction_lineage");
    controlledExpected = manifestEnvelopeSha256;
  } else if (isCorrectionTwo) {
    if (
      manifest.correctionOfEnvelopeSha256 !== CORRECTION_001_ENVELOPE_SHA256 ||
      manifest.correctionOfTrackIdFingerprint !== CORRECTION_001_TRACK_FINGERPRINT ||
      manifest.correctionOfStatus !== "RFR" ||
      manifest.statusEvidenceSource !== "human_portal_observation" ||
      manifest.portalObservedStatus !== "RECHAZADO_POR_ERROR_EN_FIRMA" ||
      manifest.portalObservedDate !== "2026-07-22" ||
      manifest.correctionReason !== "RFR_WRONG_DTE_ASSOCIATION_AND_BASE64_LINE_LENGTH" ||
      manifest.associationKey !== "dteType:folio" ||
      manifest.documentsMatched !== "8/8" ||
      !/^[a-f0-9]{64}$/.test(String(manifest.correctionOfManifestSha256 ?? "")) ||
      !/^[a-f0-9]{64}$/.test(String(manifest.correctionOfRegistrySha256 ?? "")) ||
      !/^[a-f0-9]{64}$/.test(manifestEnvelopeSha256) ||
      manifestEnvelopeSha256 !== artifactSha256 ||
      manifestEnvelopeSha256 !== expected
    )
      reject("manifest", "correction_lineage");
    controlledExpected = manifestEnvelopeSha256;
  } else if (isCorrection) {
    if (
      manifest.correctionOfEnvelopeSha256 !== SET_SHA256 ||
      manifest.correctionReason !== "STATUS_7_SCH_00001" ||
      manifest.correctionResponseSha256 !==
        "1cc59e211e5217abf6f88132a1b9c30cfba312f12bd2a8afc834d78fe31108ef" ||
      !/^[a-f0-9]{64}$/.test(manifestEnvelopeSha256) ||
      manifestEnvelopeSha256 !== artifactSha256 ||
      manifestEnvelopeSha256 !== expected
    )
      reject("manifest", "correction_lineage");
    controlledExpected = manifestEnvelopeSha256;
  }
  if (expected !== controlledExpected) reject("preflight", "expected_sha256");
  if (
    !retry &&
    env.DTE_FACTURA_CERTIFICATION_SUBMIT_CONFIRM !==
      `SUBMIT_SET_4959698_${controlledExpected}`
  )
    reject("preflight", "confirmation");
  const db = new Database(ledgerPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        "SELECT type_code,folio,state,reserved_case FROM folios ORDER BY type_code,folio",
      )
      .all() as Array<{
      type_code: number;
      folio: number;
      state: string;
      reserved_case: string | null;
    }>;
    const issued = rows.filter((r) => r.state === "issued");
    const reserved = rows.filter((r) => r.state === "reserved");
    const available = rows.filter((r) => r.state === "available");
    if (isReissue) {
      const original = issued.filter((row) =>
        String(row.reserved_case ?? "").startsWith("SET-4959698-ATTEMPT-001:"),
      );
      const reissued = issued.filter((row) =>
        String(row.reserved_case ?? "").startsWith("SET-4959698-REISSUE-001:"),
      );
      const expected = new Set([
        "33:5", "33:6", "33:7", "33:8",
        "61:4", "61:5", "61:6", "56:2",
      ]);
      const cafImports = db.prepare(
        "SELECT type_code,range_from,range_to,content_sha256 FROM caf_imports ORDER BY type_code,range_from",
      ).all() as Array<{ type_code: number; range_from: number; range_to: number; content_sha256: string }>;
      if (
        issued.length !== 16 ||
        original.length !== 8 ||
        reissued.length !== 8 ||
        reissued.some((row) => !expected.has(`${row.type_code}:${row.folio}`)) ||
        reserved.length !== 0 ||
        available.length !== 0 ||
        cafImports.length !== 5 ||
        !cafImports.some((row) => row.type_code === 33 && row.range_from === 6 && row.range_to === 8 && row.content_sha256 === "21a0d1008e2d88447811d757967a8f209bddb1c7491f967685216c82b1dd10fb") ||
        !cafImports.some((row) => row.type_code === 61 && row.range_from === 5 && row.range_to === 6 && row.content_sha256 === "db2e77e3d314e3fa4a167b483688efacc3ed51d7fdd786761ae2ad1b968eb6c1")
      )
        reject("ledger", "reissue_plan");
    } else {
      if (
        issued.length !== 8 ||
        !issued.every((r) =>
          String(r.reserved_case ?? "").startsWith("SET-4959698-ATTEMPT-001:"),
        )
      )
        reject("ledger", "issued_plan");
      if (reserved.length !== 0 || available.length !== 3)
        reject("ledger", "state_counts");
      for (const [t, f] of [[33, 5], [61, 4], [56, 2]])
        if (
          !rows.some(
            (r) => r.type_code === t && r.folio === f && r.state === "available",
          )
        )
          reject("ledger", "contingency");
    }
  } finally {
    db.close();
  }
  const seedUrl = String(env.DTE_SII_SEED_URL || SII_CERTIFICATION_SEED_URL);
  const tokenUrl = String(env.DTE_SII_TOKEN_URL || SII_CERTIFICATION_TOKEN_URL);
  if (
    seedUrl !== SII_CERTIFICATION_SEED_URL ||
    tokenUrl !== SII_CERTIFICATION_TOKEN_URL
  )
    reject("preflight", "auth_endpoint");
  const company = splitRut(required(env, "SII_RUT_EMPRESA"));
  const sender = splitRut(required(env, "SII_RUT_USUARIO"));
  return {
    envelopePath,
    manifestPath,
    ledgerPath,
    registryDir,
    registryPath,
    certPath,
    keyPath,
    envelope,
    envelopeSha256: expected,
    endpoint,
    xmlsecAvailable: true,
    xmlsecDocumentIds: xmlsec.documentIds,
    xmlsecSetDteId: xmlsec.setDteId,
    xmlsecIndividualValid: "8/8",
    xmlsecOuterValid: true,
    internalVerifier: "non_authoritative",
    signatureAuthority: "xmlsec1",
    ...(isReissue
      ? {
          artifactKind: "certification_set_reissue" as const,
          cafCoverageUnique: "8/8" as const,
          foliosPlan: "33:5-8,61:4-6,56:2" as const,
          officialFrmtValid: "8/8" as const,
          xsiPhysicallyDeclaredOnDte: "8/8" as const,
          literalStandaloneXmlsecValid: "8/8" as const,
          embeddedXmlsecValid: "8/8" as const,
          previousArtifactsUnchanged: true as const,
          previousRegistriesUnchanged: true as const,
        }
      : {}),
    company,
    sender,
    config: {
      environment: "certification",
      seedUrl,
      tokenUrl,
      submitUrl: endpoint,
      statusUrl: "",
      certPath,
      privateKeyPath: keyPath,
      rutEmpresa: required(env, "SII_RUT_EMPRESA"),
      rutUsuario: required(env, "SII_RUT_USUARIO"),
      timeoutMs: Number(env.DTE_SII_TIMEOUT_MS || 30000),
      enableSubmit: true,
    },
  };
}
export function preflightCertificationSetSubmit(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
  deps: PreflightDeps = {},
): SetSubmitPreflight {
  return preflightSetSubmit(env, repoRoot, deps);
}

const RETRY_ATTEMPT_ID = "attempt-002";
const RETRY_PORTAL_OBSERVATION = "SET_BASIC_POR_REALIZAR";
const RETRY_PORTAL_DATE = "2026-07-22";
export type RetrySetSubmitPreflight = SetSubmitPreflight & {
  attemptId: "attempt-002"; originalRegistryPath: string; originalRegistrySha256: string;
  originalResponseSha256: string; portalObservation: "SET_BASIC_POR_REALIZAR";
  portalObservedDate: "2026-07-22"; codeCommit: string;
};
function currentGitCommit(repoRoot: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0 || !/^[a-f0-9]{40}\s*$/i.test(result.stdout)) reject("preflight", "git_commit");
  return result.stdout.trim();
}
function reconcileOriginalRegistry(
  pre: SetSubmitPreflight, env: NodeJS.ProcessEnv, repoRoot: string, expectedResponseSha256: string,
): Pick<RetrySetSubmitPreflight, "originalRegistryPath" | "originalRegistrySha256" | "originalResponseSha256"> {
  const originalRegistryPath = resolve(pre.registryDir, `${pre.envelopeSha256}.json`);
  secureFile(originalRegistryPath, repoRoot, "registry", "original_record");
  const originalBytes = readFileSync(originalRegistryPath);
  const originalRegistrySha256 = required(env, "DTE_FACTURA_CERTIFICATION_RETRY_ORIGINAL_REGISTRY_SHA256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(originalRegistrySha256) || sha256(originalBytes) !== originalRegistrySha256) reject("registry", "original_hash");
  let original: Record<string, unknown>;
  try { original = JSON.parse(originalBytes.toString("utf8")); } catch (error) { reject("registry", "original_json", error); }
  const response = typeof original.response === "string" ? original.response : "";
  const classification = classifyUploadResponse(response);
  if (
    original.envelopeSha256 !== pre.envelopeSha256 || original.state !== "rejected" ||
    original.httpStatus !== 200 || !response || !classification.semanticCategory.startsWith("html_") ||
    classification.trackCandidateFingerprint ||
    /<\/?RECEPCIONDTE\b|<STATUS[^>]*>\s*0\s*<|<TRACKID\b|(?:track\s*id|n(?:u|ú)mero\s+de\s+atenci(?:o|ó)n)/i.test(response)
  ) reject("registry", "original_reconciliation");
  const originalResponseSha256 = required(env, "DTE_FACTURA_CERTIFICATION_RETRY_OF_RESPONSE_SHA256").toLowerCase();
  if (originalResponseSha256 !== expectedResponseSha256 || sha256(response) !== originalResponseSha256) reject("registry", "original_response_hash");
  return { originalRegistryPath, originalRegistrySha256, originalResponseSha256 };
}
export function preflightReconciledCertificationSetRetry(
  env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd(), deps: PreflightDeps = {},
): RetrySetSubmitPreflight {
  const pre = preflightSetSubmit(env, repoRoot, deps, true);
  if (required(env, "DTE_FACTURA_CERTIFICATION_RETRY_ATTEMPT_ID") !== RETRY_ATTEMPT_ID) reject("preflight", "retry_attempt_id");
  if (required(env, "DTE_FACTURA_CERTIFICATION_RETRY_PORTAL_OBSERVATION") !== RETRY_PORTAL_OBSERVATION) reject("preflight", "portal_observation");
  if (required(env, "DTE_FACTURA_CERTIFICATION_RETRY_PORTAL_OBSERVED_DATE") !== RETRY_PORTAL_DATE) reject("preflight", "portal_observed_date");
  const responseSha256 = required(env, "DTE_FACTURA_CERTIFICATION_RETRY_OF_RESPONSE_SHA256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(responseSha256)) reject("preflight", "retry_response_sha256");
  const confirmation = `RETRY_SET_4959698_${pre.envelopeSha256}_AFTER_HTML_${responseSha256}_PORTAL_POR_REALIZAR_2026-07-22`;
  if (env.DTE_FACTURA_CERTIFICATION_RETRY_CONFIRM !== confirmation) reject("preflight", "confirmation");
  const codeCommit = required(env, "DTE_FACTURA_CERTIFICATION_RETRY_EXPECTED_GIT_COMMIT").toLowerCase();
  if (codeCommit !== currentGitCommit(repoRoot)) reject("preflight", "git_commit");
  return { ...pre, ...reconcileOriginalRegistry(pre, env, repoRoot, responseSha256), attemptId: RETRY_ATTEMPT_ID, portalObservation: RETRY_PORTAL_OBSERVATION, portalObservedDate: RETRY_PORTAL_DATE, codeCommit };
}

type RecordState =
  "intent" | "submitting" | "submitted" | "rejected" | "ambiguous";
function atomicRecord(
  pre: SetSubmitPreflight,
  state: RecordState,
  data: Record<string, unknown> = {},
): void {
  mkdirSync(pre.registryDir, { recursive: true, mode: 0o700 });
  chmodSync(pre.registryDir, 0o700);
  const payload = JSON.stringify({
    version: 1,
    envelopeSha256: pre.envelopeSha256,
    state,
    updatedAt: new Date().toISOString(),
    ...data,
  });
  if (state === "intent") {
    writeFileSync(pre.registryPath, payload, { flag: "wx", mode: 0o600 });
    chmodSync(pre.registryPath, 0o600);
    return;
  }
  const temp = resolve(
    pre.registryDir,
    `.update-${randomBytes(8).toString("hex")}`,
  );
  writeFileSync(temp, payload, { flag: "wx", mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, pre.registryPath);
}
function atomicRetryRecord(pre: RetrySetSubmitPreflight, state: RecordState, data: Record<string, unknown> = {}): void {
  const now = new Date().toISOString();
  if (state === "intent") {
    const payload = JSON.stringify({ schemaVersion: 1, setId: "4959698", envelopeSha256: pre.envelopeSha256, attemptId: pre.attemptId, retryOfAttemptId: "attempt-001", retryOfRegistrySha256: pre.originalRegistrySha256, retryOfResponseSha256: pre.originalResponseSha256, portalObservation: pre.portalObservation, portalObservedDate: pre.portalObservedDate, codeCommit: pre.codeCommit, state, createdAt: now, updatedAt: now, endpointOrigin: "https://maullin.sii.cl", endpointPath: "/cgi_dte/UPL/DTEUpload", hardenedHeadersActive: true, redirectPolicy: "manual", statusQueryEnabled: false, ...data });
    writeFileSync(pre.registryPath, payload, { flag: "wx", mode: 0o600 }); chmodSync(pre.registryPath, 0o600); return;
  }
  secureFile(pre.registryPath, process.cwd(), "registry", "retry_record");
  const current = JSON.parse(readFileSync(pre.registryPath, "utf8")) as Record<string, unknown>;
  const allowed = (current.state === "intent" && state === "submitting") || (current.state === "submitting" && ["submitted", "rejected", "ambiguous"].includes(state));
  if (!allowed) reject("registry", "retry_transition");
  const temp = resolve(pre.registryDir, ".attempt-002-" + randomBytes(8).toString("hex"));
  writeFileSync(temp, JSON.stringify({ ...current, state, updatedAt: now, ...data }), { flag: "wx", mode: 0o600 }); chmodSync(temp, 0o600); renameSync(temp, pre.registryPath);
}

function fingerprint(value: string | null | undefined): string | null {
  return value ? sha256(value).slice(0, 16) : null;
}
const UPLOAD_USER_AGENT = "PROG 1.0";
const UPLOAD_REFERER = "https://maullin.sii.cl/";
type UploadResponseClassification = {
  kind: "accepted" | "rejected" | "ambiguous";
  status: string | null;
  trackId: string | null;
  trackCandidateFingerprint: string | null;
  semanticCategory: string;
};
function localName(value: {
  localName?: string | null;
  nodeName: string;
}): string {
  return String(value.localName || value.nodeName).replace(/^.*:/, "");
}
export function classifyUploadResponse(
  raw: string,
): UploadResponseClassification {
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const looksHtml = /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(raw);
  const candidate =
    raw.match(
      /(?:track\s*id|trackid|n(?:u|ú)mero\s+de\s+atenci(?:o|ó)n|nro\.?\s*atenci(?:o|ó)n)[^0-9]{0,80}([0-9]{5,30})/i,
    )?.[1] ?? null;
  if (looksHtml) {
    const semanticCategory = candidate
      ? "possible_html_receipt"
      : /(?:login|autenticacion|iniciar sesion|sesion.{0,30}(?:expir|caduc|venc))/.test(
            normalized,
          )
        ? "html_login_or_session"
        : /(?:error|problema|fallo|invalido)/.test(normalized)
          ? "html_error"
          : "html_generic";
    return {
      kind: "ambiguous",
      status: null,
      trackId: null,
      trackCandidateFingerprint: fingerprint(candidate),
      semanticCategory,
    };
  }
  const errors: string[] = [];
  let document: ReturnType<DOMParser["parseFromString"]>;
  try {
    document = new DOMParser({
      onError: (level) => {
        if (level !== "warning") errors.push(level);
      },
    }).parseFromString(raw, "application/xml");
  } catch {
    return {
      kind: "ambiguous",
      status: null,
      trackId: null,
      trackCandidateFingerprint: null,
      semanticCategory: "unexpected_response",
    };
  }
  const root = document.documentElement;
  if (
    !root ||
    errors.length ||
    localName(root).toUpperCase() !== "RECEPCIONDTE"
  )
    return {
      kind: "ambiguous",
      status: null,
      trackId: null,
      trackCandidateFingerprint: null,
      semanticCategory: "unexpected_response",
    };
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  const text = (name: string) =>
    elements
      .find((element) => localName(element).toUpperCase() === name)
      ?.textContent?.trim() ?? null;
  const status = text("STATUS");
  const trackId = text("TRACKID");
  if (status === "0" && trackId)
    return {
      kind: "accepted",
      status,
      trackId,
      trackCandidateFingerprint: null,
      semanticCategory: "xml_receipt",
    };
  if (status && status !== "0")
    return {
      kind: "rejected",
      status,
      trackId: null,
      trackCandidateFingerprint: null,
      semanticCategory: "explicit_sii_rejection",
    };
  return {
    kind: "ambiguous",
    status,
    trackId: null,
    trackCandidateFingerprint: null,
    semanticCategory: "incomplete_xml_receipt",
  };
}
function safeResponseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "maullin.sii.cl"
      ? `${url.origin}${url.pathname}`
      : null;
  } catch {
    return null;
  }
}
export type SubmitResult = {
  status: "SUBMITTED" | "REJECTED" | "AMBIGUOUS";
  receptionStatus: string;
  envelopeSha256: string;
  tokenFingerprint: string | null;
  trackIdStored: boolean;
  trackIdFingerprint: string | null;
  siiContacted: boolean;
  submitted: boolean;
  statusQueried: false;
};
export async function submitReconciledCertificationSetRetry(env: NodeJS.ProcessEnv = process.env, deps: PreflightDeps & { fetchImpl?: typeof fetch } = {}): Promise<SubmitResult> {
  const pre = preflightReconciledCertificationSetRetry(env, process.cwd(), deps);
  atomicRetryRecord(pre, "intent"); atomicRetryRecord(pre, "submitting");
  let contacted = false; let tokenFingerprint: string | null = null;
  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const seed = await requestSeed(pre.config, { fetchImpl }); contacted = true;
    if (!seed.seed) reject("seed", "response");
    const token = await requestToken(signSeed(seed.seed, pre.config).signedSeed ?? "", pre.config, { fetchImpl });
    if (!token.token) reject("token", "response"); tokenFingerprint = fingerprint(token.token);
    const form = new FormData(); form.set("rutSender", pre.sender.rut); form.set("dvSender", pre.sender.dv); form.set("rutCompany", pre.company.rut); form.set("dvCompany", pre.company.dv); form.set("archivo", new Blob([Uint8Array.from(pre.envelope)], { type: "text/xml" }), basename(pre.envelopePath));
    const response = await fetchImpl(pre.endpoint, { method: "POST", headers: { "user-agent": UPLOAD_USER_AGENT, accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8", "accept-language": "es-cl", referer: UPLOAD_REFERER, "cache-control": "no-cache", cookie: "TOKEN=" + token.token }, body: form, redirect: "manual", signal: AbortSignal.timeout(pre.config.timeoutMs) }); contacted = true;
    const raw = await response.text(); const classification = classifyUploadResponse(raw);
    const metadata = { httpStatus: response.status, responseContentType: response.headers.get("content-type"), responseBytes: Buffer.byteLength(raw, "utf8"), responseSha256: sha256(raw), responseSemanticCategory: classification.semanticCategory, tokenFingerprint, locationFingerprint: fingerprint(response.headers.get("location")) };
    if (response.status >= 300 && response.status < 400 || !response.ok || classification.kind !== "accepted") {
      const state: RecordState = classification.kind === "rejected" && response.ok ? "rejected" : "ambiguous"; atomicRetryRecord(pre, state, { ...metadata, response: raw, trackCandidateFingerprint: classification.trackCandidateFingerprint });
      return { status: state === "rejected" ? "REJECTED" : "AMBIGUOUS", receptionStatus: classification.status ?? "invalid", envelopeSha256: pre.envelopeSha256, tokenFingerprint, trackIdStored: false, trackIdFingerprint: null, siiContacted: contacted, submitted: false, statusQueried: false };
    }
    atomicRetryRecord(pre, "submitted", { ...metadata, response: raw, trackId: classification.trackId });
    return { status: "SUBMITTED", receptionStatus: "0", envelopeSha256: pre.envelopeSha256, tokenFingerprint, trackIdStored: true, trackIdFingerprint: fingerprint(classification.trackId), siiContacted: true, submitted: true, statusQueried: false };
  } catch (error) {
    atomicRetryRecord(pre, "ambiguous", { tokenFingerprint, errorCode: error instanceof ControlledSetSubmitError ? error.code : "NETWORK_OR_INTERNAL" });
    if (error instanceof ControlledSetSubmitError) throw error; throw new ControlledSetSubmitError(contacted ? "submit" : "seed", "ambiguous", error);
  }
}

export async function submitPreparedCertificationSet(
  env: NodeJS.ProcessEnv = process.env,
  deps: PreflightDeps & { fetchImpl?: typeof fetch } = {},
): Promise<SubmitResult> {
  const pre = preflightCertificationSetSubmit(env, process.cwd(), deps);
  atomicRecord(pre, "intent");
  atomicRecord(pre, "submitting");
  let contacted = false;
  let tokenFingerprint: string | null = null;
  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const seed = await requestSeed(pre.config, { fetchImpl });
    contacted = true;
    if (!seed.seed) reject("seed", "response");
    const signed = signSeed(seed.seed, pre.config);
    const token = await requestToken(signed.signedSeed ?? "", pre.config, {
      fetchImpl,
    });
    if (!token.token) reject("token", "response");
    tokenFingerprint = fingerprint(token.token);
    const form = new FormData();
    form.set("rutSender", pre.sender.rut);
    form.set("dvSender", pre.sender.dv);
    form.set("rutCompany", pre.company.rut);
    form.set("dvCompany", pre.company.dv);
    form.set(
      "archivo",
      new Blob([Uint8Array.from(pre.envelope)], { type: "text/xml" }),
      basename(pre.envelopePath),
    );
    const response = await fetchImpl(pre.endpoint, {
      method: "POST",
      headers: {
        "user-agent": UPLOAD_USER_AGENT,
        accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8",
        "accept-language": "es-cl",
        referer: UPLOAD_REFERER,
        "cache-control": "no-cache",
        cookie: `TOKEN=${token.token}`,
      },
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(pre.config.timeoutMs),
    });
    contacted = true;
    const raw = await response.text();
    const responseMetadata = {
      httpStatus: response.status,
      responseContentType: response.headers.get("content-type"),
      responseUrl: safeResponseUrl(response.url),
      redirected: response.redirected,
      responseBytes: Buffer.byteLength(raw, "utf8"),
      responseSha256: sha256(raw),
      requestMetadata: {
        multipartBoundaryConsistent: true,
        rutSenderFieldPresent: true,
        dvSenderFieldPresent: true,
        rutCompanyFieldPresent: true,
        dvCompanyFieldPresent: true,
        archivoFieldPresent: true,
        filenamePresent: true,
        contentTypeXml: true,
        tokenCookiePresent: true,
        requestBodyLengthPositive: pre.envelope.length > 0,
        endpointExact: pre.endpoint === SET_SUBMIT_URL,
        redirectManual: true,
        userAgentProgPresent: true,
        refererPresent: true,
      },
    };
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400) {
      atomicRecord(pre, "ambiguous", {
        response: raw,
        ...responseMetadata,
        locationFingerprint: fingerprint(location),
        semanticCategory: "http_redirect",
        tokenFingerprint,
      });
      return {
        status: "AMBIGUOUS",
        receptionStatus: "redirect",
        envelopeSha256: pre.envelopeSha256,
        tokenFingerprint,
        trackIdStored: false,
        trackIdFingerprint: null,
        siiContacted: true,
        submitted: false,
        statusQueried: false,
      };
    }
    const classification = classifyUploadResponse(raw);
    if (!response.ok || classification.kind !== "accepted") {
      const state =
        classification.kind === "rejected" ? "rejected" : "ambiguous";
      atomicRecord(pre, state, {
        response: raw,
        ...responseMetadata,
        semanticCategory: classification.semanticCategory,
        trackCandidateFingerprint: classification.trackCandidateFingerprint,
        tokenFingerprint,
      });
      return {
        status: state === "rejected" ? "REJECTED" : "AMBIGUOUS",
        receptionStatus: classification.status ?? "invalid",
        envelopeSha256: pre.envelopeSha256,
        tokenFingerprint,
        trackIdStored: false,
        trackIdFingerprint: null,
        siiContacted: contacted,
        submitted: false,
        statusQueried: false,
      };
    }
    atomicRecord(pre, "submitted", {
      response: raw,
      ...responseMetadata,
      semanticCategory: classification.semanticCategory,
      trackId: classification.trackId,
      tokenFingerprint,
    });
    return {
      status: "SUBMITTED",
      receptionStatus: "0",
      envelopeSha256: pre.envelopeSha256,
      tokenFingerprint,
      trackIdStored: true,
      trackIdFingerprint: fingerprint(classification.trackId),
      siiContacted: true,
      submitted: true,
      statusQueried: false,
    };
  } catch (error) {
    atomicRecord(pre, "ambiguous", {
      tokenFingerprint,
      errorCode:
        error instanceof ControlledSetSubmitError
          ? error.code
          : "NETWORK_OR_INTERNAL",
    });
    if (error instanceof ControlledSetSubmitError) throw error;
    throw new ControlledSetSubmitError(
      contacted ? "submit" : "seed",
      "ambiguous",
      error,
    );
  }
}
export function formatSubmitPreflight(pre: SetSubmitPreflight): string {
  return [
    `status=READY_TO_SUBMIT`,
    "envelopeSha256=" + pre.envelopeSha256,
    "xmlsecAvailable=" + pre.xmlsecAvailable,
    "xmlsecIndividualValid=" + pre.xmlsecIndividualValid,
    "xmlsecOuterValid=" + pre.xmlsecOuterValid,
    "internalVerifier=" + pre.internalVerifier,
    "signatureAuthority=" + pre.signatureAuthority,
    ...(pre.artifactKind
      ? [
          "artifactKind=" + pre.artifactKind,
          "cafCoverageUnique=" + pre.cafCoverageUnique,
          "foliosPlan=" + pre.foliosPlan,
          "officialFrmtValid=" + pre.officialFrmtValid,
          "xsiPhysicallyDeclaredOnDte=" + pre.xsiPhysicallyDeclaredOnDte,
          "literalStandaloneXmlsecValid=" + pre.literalStandaloneXmlsecValid,
          "embeddedXmlsecValid=" + pre.embeddedXmlsecValid,
          "previousArtifactsUnchanged=" + pre.previousArtifactsUnchanged,
          "previousRegistriesUnchanged=" + pre.previousRegistriesUnchanged,
        ]
      : []),
    "siiContacted=false",
    "submitted=false",
    "statusQueried=false",
  ].join("\n");
}
export function formatRetryPreflight(pre: RetrySetSubmitPreflight): string {
  return ["status=READY_TO_RETRY", "attemptId=" + pre.attemptId, "retryAuthorized=true", "originalRegistryValid=true", "originalRegistryHashMatch=true", "originalResponseHashMatch=true", "originalTrackAbsent=true", "originalStatusZeroAbsent=true", "portalObservationAccepted=true", "portalObservedDateAccepted=true", "envelopeHashMatch=true", "manifestValid=true", "ledgerIssued=8", "contingencyAvailable=3", "endpointAllowed=true", "hardenedHeadersActive=true", "redirectManual=true", "retryRecordExists=false", "thirdAttemptBlocked=true", "siiContacted=false", "submitted=false", "statusQueried=false", "ready=true"].join("\n");
}
export function formatSubmitResult(result: SubmitResult): string {
  return Object.entries(result)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}
export function formatSubmitError(error: unknown): string {
  const safe =
    error instanceof ControlledSetSubmitError
      ? error
      : new ControlledSetSubmitError("preflight", "internal", error);
  return [
    `status=REJECTED`,
    `code=${safe.code}`,
    `stage=${safe.stage}`,
    `field=${safe.field}`,
    "message=controlled_operation_failed",
  ].join("\n");
}

const CORRECTION_002_DELIVERY_ATTEMPT_ID = "correction-002-delivery-attempt-002";
const CORRECTION_002_DELIVERY_SHA256 = "fc9a2a5836c8e93d0c6f26bf405d9ddb7db8b86b5d50d90c3ffeccc26ee62094";
const CORRECTION_002_DELIVERY_CONFIRM = "RETRY_CORRECTION_002_SET_4959698_fc9a2a5836c8e93d0c6f26bf405d9ddb7db8b86b5d50d90c3ffeccc26ee62094_AMBIGUOUS_NO_RESPONSE_PORTAL_POR_REALIZAR_2026-07-22";
type DeliveryAttemptStage = "intent" | "seed_started" | "seed_completed" | "token_started" | "token_completed" | "multipart_built" | "upload_started" | "response_headers_received" | "response_body_stored" | "submitted" | "rejected" | "ambiguous";
export type Correction002DeliveryRetryPreflight = SetSubmitPreflight & { attemptId: typeof CORRECTION_002_DELIVERY_ATTEMPT_ID; priorRegistryPath: string; deliveryRegistryPath: string };
export type DeliveryRetryDeps = PreflightDeps & { fetchImpl?: typeof fetch; individualSignature?: (bytes: Buffer, certificatePem: string) => boolean; dteXsd?: (path: string) => boolean };
function deliveryRegistryPath(pre: SetSubmitPreflight): string { return resolve(pre.registryDir, `${pre.envelopeSha256}.${CORRECTION_002_DELIVERY_ATTEMPT_ID}.json`); }
function base64LinesValid(xml: string): boolean { for (const match of xml.matchAll(/<(FRMT|SignatureValue|X509Certificate)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) if (match[2].split("\n").some((line) => line.length > 76)) return false; return true; }
function deliveryRecord(pre: Correction002DeliveryRetryPreflight, stage: DeliveryAttemptStage, data: Record<string, unknown> = {}): void {
  const now = new Date().toISOString();
  if (stage === "intent") {
    writeFileSync(pre.deliveryRegistryPath, JSON.stringify({ schemaVersion: 1, setId: "4959698", envelopeSha256: pre.envelopeSha256, attemptId: pre.attemptId, retryOfRegistryPath: basename(pre.priorRegistryPath), portalObservation: "SET_BASIC_POR_REALIZAR", portalObservedDate: "2026-07-22", stage, stages: [{ stage, at: now }], createdAt: now, updatedAt: now, statusQueryEnabled: false, ...data }), { flag: "wx", mode: 0o600 });
    chmodSync(pre.deliveryRegistryPath, 0o600); return;
  }
  secureFile(pre.deliveryRegistryPath, process.cwd(), "registry", "delivery_retry_record");
  const current = JSON.parse(readFileSync(pre.deliveryRegistryPath, "utf8")) as Record<string, unknown>;
  const stages = Array.isArray(current.stages) ? current.stages : [];
  const temp = resolve(pre.registryDir, `.delivery-${randomBytes(8).toString("hex")}`);
  writeFileSync(temp, JSON.stringify({ ...current, stage, stages: [...stages, { stage, at: now }], updatedAt: now, ...data }), { flag: "wx", mode: 0o600 });
  chmodSync(temp, 0o600); renameSync(temp, pre.deliveryRegistryPath);
}
function safeDeliveryError(error: unknown): { errorName: string; errorCode: string; causeCode: string; abortTriggered: boolean } {
  const value = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } };
  const known = /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT)$/;
  const code = typeof value?.code === "string" && known.test(value.code) ? value.code : "none";
  const causeCode = typeof value?.cause?.code === "string" && known.test(value.cause.code) ? value.cause.code : "none";
  const errorName = value?.name === "AbortError" || value?.name === "TypeError" ? value.name : "Error";
  return { errorName, errorCode: code, causeCode, abortTriggered: value?.name === "AbortError" };
}
function validateCorrection002DeliveryArtifacts(pre: SetSubmitPreflight, deps: DeliveryRetryDeps): void {
  if (pre.envelopeSha256 !== (deps.expectedSha256 ?? CORRECTION_002_DELIVERY_SHA256) || !base64LinesValid(pre.envelope.toString("latin1"))) reject("envelope", "delivery_artifacts");
  const manifest = JSON.parse(readFileSync(pre.manifestPath, "utf8")) as { files?: Array<{ file?: unknown }> };
  const dtes = (manifest.files ?? []).filter((item) => /^4959698-[1-8]-DTE-CERTIFICATION\.xml$/.test(String(item.file ?? "")));
  if (dtes.length !== 8) reject("manifest", "delivery_documents");
  const certificate = readFileSync(pre.certPath, "utf8");
  for (const item of dtes) {
    const file = resolve(dirname(pre.manifestPath), String(item.file));
    const bytes = readFileSync(file);
    const signatureOk = deps.individualSignature ? deps.individualSignature(bytes, certificate) : diagnosePersistedXmlSignature(bytes, certificate, "Documento").valid;
    const xsdOk = deps.dteXsd ? deps.dteXsd(file) : spawnSync("xmllint", ["--noout", "--schema", "DTE_v10.xsd", file], { cwd: resolve(process.cwd(), "docs/dte-sii/xsd"), stdio: "ignore" }).status === 0;
    if (!signatureOk || !xsdOk || !base64LinesValid(bytes.toString("latin1"))) reject("envelope", "delivery_documents");
  }
}
export function preflightCorrection002DeliveryRetry(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd(), deps: DeliveryRetryDeps = {}): Correction002DeliveryRetryPreflight {
  const pre = preflightSetSubmit(env, repoRoot, deps, true);
  const deliverySha = deps.expectedSha256 ?? CORRECTION_002_DELIVERY_SHA256;
  const deliveryConfirmation = deps.expectedSha256 ? required(env, "DTE_FACTURA_CERTIFICATION_DELIVERY_RETRY_CONFIRM") : CORRECTION_002_DELIVERY_CONFIRM;
  if (pre.envelopeSha256 !== deliverySha || required(env, "DTE_FACTURA_CERTIFICATION_DELIVERY_RETRY_ATTEMPT_ID") !== CORRECTION_002_DELIVERY_ATTEMPT_ID || required(env, "DTE_FACTURA_CERTIFICATION_DELIVERY_RETRY_CONFIRM") !== deliveryConfirmation || required(env, "DTE_FACTURA_CERTIFICATION_DELIVERY_RETRY_PORTAL_OBSERVATION") !== "SET_BASIC_POR_REALIZAR" || required(env, "DTE_FACTURA_CERTIFICATION_DELIVERY_RETRY_PORTAL_OBSERVED_DATE") !== "2026-07-22") reject("preflight", "delivery_retry_contract");
  const priorRegistryPath = resolve(pre.registryDir, `${pre.envelopeSha256}.json`);
  secureFile(priorRegistryPath, repoRoot, "registry", "delivery_prior_record");
  const prior = JSON.parse(readFileSync(priorRegistryPath, "utf8")) as Record<string, unknown>;
  if (prior.envelopeSha256 !== pre.envelopeSha256 || prior.state !== "ambiguous" || prior.httpStatus !== undefined || typeof prior.response === "string" || typeof prior.trackId === "string") reject("registry", "delivery_prior_record");
  const path = deliveryRegistryPath(pre);
  if (existsSync(path)) reject("registry", "delivery_retry_exists");
  validateCorrection002DeliveryArtifacts(pre, deps);
  return { ...pre, attemptId: CORRECTION_002_DELIVERY_ATTEMPT_ID, priorRegistryPath, deliveryRegistryPath: path };
}
export async function submitCorrection002DeliveryRetry(env: NodeJS.ProcessEnv = process.env, deps: DeliveryRetryDeps = {}): Promise<SubmitResult> {
  const pre = preflightCorrection002DeliveryRetry(env, process.cwd(), deps);
  deliveryRecord(pre, "intent");
  let failureStage = "seed"; let uploadStarted = false; let tokenFingerprint: string | null = null;
  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    deliveryRecord(pre, "seed_started");
    const seed = await requestSeed(pre.config, { fetchImpl });
    if (!seed.seed) reject("seed", "response");
    deliveryRecord(pre, "seed_completed");
    failureStage = "token"; deliveryRecord(pre, "token_started");
    const token = await requestToken(signSeed(seed.seed, pre.config).signedSeed ?? "", pre.config, { fetchImpl });
    if (!token.token) reject("token", "response");
    tokenFingerprint = fingerprint(token.token); deliveryRecord(pre, "token_completed", { tokenFingerprint });
    failureStage = "multipart_build";
    const form = new FormData(); form.set("rutSender", pre.sender.rut); form.set("dvSender", pre.sender.dv); form.set("rutCompany", pre.company.rut); form.set("dvCompany", pre.company.dv); form.set("archivo", new Blob([Uint8Array.from(pre.envelope)], { type: "text/xml" }), basename(pre.envelopePath));
    deliveryRecord(pre, "multipart_built", { multipartBuilt: true });
    failureStage = "upload_connect"; uploadStarted = true; deliveryRecord(pre, "upload_started", { uploadStarted: true, siiUploadContacted: true });
    const response = await fetchImpl(pre.endpoint, { method: "POST", headers: { "user-agent": UPLOAD_USER_AGENT, accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8", "accept-language": "es-cl", referer: UPLOAD_REFERER, "cache-control": "no-cache", cookie: `TOKEN=${token.token}` }, body: form, redirect: "manual", signal: AbortSignal.timeout(pre.config.timeoutMs) });
    failureStage = "upload_wait_response"; deliveryRecord(pre, "response_headers_received", { responseHeadersReceived: true, httpStatus: response.status, responseContentType: response.headers.get("content-type"), locationFingerprint: fingerprint(response.headers.get("location")) });
    const raw = await response.text(); const classification = classifyUploadResponse(raw);
    deliveryRecord(pre, "response_body_stored", { responseBodyStored: true, responseBytes: Buffer.byteLength(raw, "utf8"), responseSha256: sha256(raw), receptionStatus: classification.status ?? "invalid" });
    if (classification.kind === "accepted" && response.ok) { deliveryRecord(pre, "submitted", { trackId: classification.trackId, trackIdFingerprint: fingerprint(classification.trackId), submitted: true }); return { status: "SUBMITTED", receptionStatus: "0", envelopeSha256: pre.envelopeSha256, tokenFingerprint, trackIdStored: true, trackIdFingerprint: fingerprint(classification.trackId), siiContacted: true, submitted: true, statusQueried: false }; }
    if (classification.kind === "rejected") { deliveryRecord(pre, "rejected", { submitted: false, receptionStatus: classification.status ?? "invalid" }); return { status: "REJECTED", receptionStatus: classification.status ?? "invalid", envelopeSha256: pre.envelopeSha256, tokenFingerprint, trackIdStored: false, trackIdFingerprint: null, siiContacted: true, submitted: false, statusQueried: false }; }
    deliveryRecord(pre, "ambiguous", { submitted: false, receptionStatus: classification.status ?? "invalid", failureStage }); return { status: "AMBIGUOUS", receptionStatus: classification.status ?? "invalid", envelopeSha256: pre.envelopeSha256, tokenFingerprint, trackIdStored: false, trackIdFingerprint: null, siiContacted: true, submitted: false, statusQueried: false };
  } catch (error) {
    const safe = safeDeliveryError(error); const finalStage = uploadStarted ? "ambiguous" : "ambiguous";
    deliveryRecord(pre, finalStage, { ...safe, failureStage, uploadStarted, siiUploadContacted: uploadStarted, safeToClassifyNotDelivered: !uploadStarted, submitted: false });
    return { status: "AMBIGUOUS", receptionStatus: "invalid", envelopeSha256: pre.envelopeSha256, tokenFingerprint, trackIdStored: false, trackIdFingerprint: null, siiContacted: uploadStarted, submitted: false, statusQueried: false };
  }
}
