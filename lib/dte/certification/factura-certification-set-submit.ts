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
export type PreflightDeps = {
  signature?: (bytes: Buffer, certificatePem: string) => boolean;
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
  company: { rut: string; dv: string };
  sender: { rut: string; dv: string };
  config: SiiCertificationConfig;
};
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
  const controlledExpected = deps.expectedSha256 ?? SET_SHA256;
  const expected = required(
    env,
    "DTE_FACTURA_CERTIFICATION_ENVELOPE_SHA256",
  ).toLowerCase();
  if (expected !== controlledExpected) reject("preflight", "expected_sha256");
  if (!retry && env.DTE_FACTURA_CERTIFICATION_SUBMIT_CONFIRM !== `SUBMIT_SET_4959698_${controlledExpected}`)
    reject("preflight", "confirmation");
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
  const signatureValid = deps.signature
    ? deps.signature(envelope, certificatePem)
    : diagnosePersistedXmlSignature(envelope, certificatePem).valid;
  if (!signatureValid) reject("envelope", "signature");
  let manifest: {
    fixtureMode?: boolean;
    files?: Array<{ file?: unknown; sha256?: unknown }>;
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
    if (
      issued.length !== 8 ||
      !issued.every((r) =>
        String(r.reserved_case ?? "").startsWith("SET-4959698-ATTEMPT-001:"),
      )
    )
      reject("ledger", "issued_plan");
    if (reserved.length !== 0 || available.length !== 3)
      reject("ledger", "state_counts");
    for (const [t, f] of [
      [33, 5],
      [61, 4],
      [56, 2],
    ])
      if (
        !rows.some(
          (r) => r.type_code === t && r.folio === f && r.state === "available",
        )
      )
        reject("ledger", "contingency");
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
    `envelopeSha256=${pre.envelopeSha256}`,
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
