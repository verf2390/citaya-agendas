import { DOMParser } from "@xmldom/xmldom";
import Database from "better-sqlite3";
import { SignedXml } from "xml-crypto";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { validateRut } from "../rut";
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
function validateXmlSignature(xml: string, certificatePem: string): boolean {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const nodes = doc.getElementsByTagNameNS(
    "http://www.w3.org/2000/09/xmldsig#",
    "Signature",
  );
  if (nodes.length !== 1) return false;
  const verifier = new SignedXml({ publicCert: certificatePem });
  verifier.loadSignature(nodes[0] as never);
  return verifier.checkSignature(xml);
}
export type PreflightDeps = {
  signature?: typeof validateXmlSignature;
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
export function preflightCertificationSetSubmit(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
  deps: PreflightDeps = {},
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
  if (
    env.DTE_FACTURA_CERTIFICATION_SUBMIT_CONFIRM !==
    `SUBMIT_SET_4959698_${controlledExpected}`
  )
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
  const registryPath = resolve(registryDir, `${expected}.json`);
  if (existsSync(registryPath)) reject("registry", "existing_record");
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
  const xsd =
    deps.xsd ??
    ((path) =>
      spawnSync("xmllint", ["--noout", "--schema", "EnvioDTE_v10.xsd", path], {
        cwd: resolve(repoRoot, "docs/dte-sii/xsd"),
        stdio: "ignore",
      }).status === 0);
  if (!xsd(envelopePath)) reject("envelope", "xsd");
  const signature = deps.signature ?? validateXmlSignature;
  if (!signature(xml, readFileSync(certPath, "utf8")))
    reject("envelope", "signature");
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
    if (
      issued.length !== 8 ||
      !issued.every((r) =>
        String(r.reserved_case ?? "").startsWith("SET-4959698-ATTEMPT-001:"),
      )
    )
      reject("ledger", "issued_plan");
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
function fingerprint(value: string | null | undefined): string | null {
  return value ? sha256(value).slice(0, 16) : null;
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
      headers: { cookie: `TOKEN=${token.token}` },
      body: form,
      signal: AbortSignal.timeout(pre.config.timeoutMs),
    });
    contacted = true;
    const raw = await response.text();
    const status = raw.match(/<STATUS[^>]*>([^<]+)</i)?.[1]?.trim() ?? null;
    const track = raw.match(/<TRACKID[^>]*>([^<]+)</i)?.[1]?.trim() ?? null;
    if (!response.ok || status !== "0" || !track) {
      atomicRecord(pre, "rejected", {
        response: raw,
        httpStatus: response.status,
        tokenFingerprint,
      });
      return {
        status: "REJECTED",
        receptionStatus: status ?? "invalid",
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
      httpStatus: response.status,
      trackId: track,
      tokenFingerprint,
    });
    return {
      status: "SUBMITTED",
      receptionStatus: "0",
      envelopeSha256: pre.envelopeSha256,
      tokenFingerprint,
      trackIdStored: true,
      trackIdFingerprint: fingerprint(track),
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
