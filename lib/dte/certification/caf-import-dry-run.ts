import { createHash, createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { escapeXml } from "../xml/escape-xml";
import { loadFacturaPreCafInputFromPath } from "./pre-caf-input-loader";
import { assertNoOverlappingOrDuplicateCafs, loadCafAuthorization, type CafTrustStore, type ImportedCaf } from "./caf-secure-import";
import { FolioSqliteLedger } from "./folio-sqlite-ledger";

export const CAF_IMPORT_FIXTURE_DIR = "/home/verf/secure/dte-lab/caf-import-dry-run";
const TYPES = [{ type: 33 as const, count: 4, start: 330101 }, { type: 61 as const, count: 3, start: 610101 }, { type: 56 as const, count: 1, start: 560101 }];
const IDK = "900001";

function fail(field: string): never { throw new Error(`PRE_CAF_12_REJECTED field=${field}`); }
function outside(repoRoot: string, path: string): boolean { const rel = relative(resolve(repoRoot), resolve(path)); return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`); }
function publicParts(publicKey: string): { modulus: string; exponent: string } {
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as { n?: string; e?: string }; if (!jwk.n || !jwk.e) fail("RSAPUBK");
  return { modulus: Buffer.from(jwk.n, "base64url").toString("base64"), exponent: Buffer.from(jwk.e, "base64url").toString("base64") };
}
function writePrivate(path: string, data: string | Buffer): void { writeFileSync(path, data, { mode: 0o600 }); chmodSync(path, 0o600); }

export function prepareFixtureCafVault(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd(), outputDir = CAF_IMPORT_FIXTURE_DIR): { cafs: ImportedCaf[]; dbPath: string; outputDir: string } {
  if (env.DTE_SII_ENV !== "certification" || env.DTE_MODE === "production" || env.NODE_ENV === "production") fail("environment");
  if (env.DTE_CAF_PATH || env.DTE_CAF_PRIVATE_KEY_PATH || env.DTE_CERT_PATH || env.DTE_PRIVATE_KEY_PATH || env.DTE_SII_TOKEN || env.DTE_TRACK_ID || env.DTE_SII_ENABLE_SUBMIT === "true") fail("realMaterial");
  if (outside(repoRoot, outputDir)) fail("outputDir");
  mkdirSync(outputDir, { recursive: true, mode: 0o700 }); chmodSync(outputDir, 0o700);
  const loaded = loadFacturaPreCafInputFromPath({ inputPath: env.DTE_FACTURA_PRE_CAF_INPUT_PATH, repoRoot, env: { ...env, DTE_FACTURA_PRE_CAF_ISSUE_DATE: env.DTE_CERTIFICATION_ISSUE_DATE } });
  if (!loaded.ok || !loaded.input.issuer?.rutEmisor || !loaded.input.issuer.razonSocial) fail("externalContract");
  const authority = generateKeyPairSync("rsa", { modulusLength: 768, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const anchorPath = join(outputDir, "fixture-trust-anchor-public.pem"); writePrivate(anchorPath, authority.publicKey);
  const anchorHash = createHash("sha256").update(readFileSync(anchorPath)).digest("hex");
  const trustStore: CafTrustStore = new Map([[IDK, { idk: IDK, mode: "fixture", publicKeyPath: anchorPath, provenance: "generated:PRE-CAF-12:fixture-only", sha256: anchorHash }]]);
  const cafs = TYPES.map(({ type, count, start }) => {
    const cafKeys = generateKeyPairSync("rsa", { modulusLength: 768, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const parts = publicParts(cafKeys.publicKey); const end = start + Math.max(count, 4) - 1;
    const da = `<DA><RE>${escapeXml(loaded.input.issuer!.rutEmisor!)}</RE><RS>${escapeXml(loaded.input.issuer!.razonSocial!.slice(0, 40))}</RS><TD>${type}</TD><RNG><D>${start}</D><H>${end}</H></RNG><FA>2026-07-19</FA><RSAPK><M>${parts.modulus}</M><E>${parts.exponent}</E></RSAPK><IDK>${IDK}</IDK></DA>`;
    const signer = createSign("RSA-SHA1"); signer.update(Buffer.from(da, "latin1")); const frma = signer.sign(authority.privateKey, "base64");
    const caf = `<CAF version="1.0">${da}<FRMA algoritmo="SHA1withRSA">${frma}</FRMA></CAF>`;
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<AUTORIZACION>${caf}<RSASK>${cafKeys.privateKey.trim()}</RSASK><RSAPUBK>${cafKeys.publicKey.trim()}</RSAPUBK></AUTORIZACION>\n`;
    const path = join(outputDir, `fixture-caf-type-${type}.xml`); writePrivate(path, Buffer.from(xml, "latin1"));
    return loadCafAuthorization(path, { repoRoot, expectedIssuerRut: loaded.input.issuer!.rutEmisor!, expectedType: type, minimumAvailable: count, trustStore, fixtureMode: true });
  });
  assertNoOverlappingOrDuplicateCafs(cafs);
  const manifest = { fixtureMode: true, legalValidity: "SIN_VALIDEZ_TRIBUTARIA", files: cafs.map((caf) => ({ name: caf.sourcePath.split("/").pop(), sha256: caf.sha256 })), trustAnchor: { idk: IDK, provenance: "generated fixture", sha256: anchorHash } };
  writePrivate(join(outputDir, "manifest-FIXTURE-SIN-VALIDEZ.json"), JSON.stringify(manifest, null, 2));
  const dbPath = join(outputDir, "folio-ledger-fixture.sqlite"); rmSync(dbPath, { force: true }); const ledger = new FolioSqliteLedger(dbPath); try { for (const caf of cafs) ledger.importCaf(caf); } finally { ledger.close(); } chmodSync(dbPath, 0o600);
  return { cafs, dbPath, outputDir };
}

export function runCafImportDryRun(env: NodeJS.ProcessEnv = process.env): void {
  const prepared = prepareFixtureCafVault(env);
  if (prepared.cafs.length !== 3 || !prepared.cafs.every((caf) => caf.weakLegacyFixture && caf.realUseBlocked && caf.cafBytes.equals(Buffer.from(caf.cafXml, "latin1")))) fail("audit");
  console.log("environment=certification\nfixtureMode=true\nrequiredCafTypes=3\ncafStructure=3/3\ncafIssuerMatch=3/3\ncafSiiSignatureFixture=3/3\ncafKeyPairMatch=3/3\ncafPublicKeyMatch=3/3\ncafPreserved=3/3\nfixtureKey=true\nweakLegacyFixture=true\nrealUseBlocked=true\nofficialSiiTrustAnchor=pending_real_caf_idk\nrealCaf=false\nsiiContacted=false\nreadyToDownloadCaf=false");
}
