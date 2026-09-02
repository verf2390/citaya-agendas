import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  createSign,
  generateKeyPairSync,
} from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  auditRealCertificationCafBundle,
  formatRealCafBundleAudit,
} from "../certification/caf-real-bundle-audit";
import { expectedCertificationFolioPlan } from "../certification/factura-certification-set-prepare";

const RUT = "76086428-5";
const fetchBeforeBundleTests = globalThis.fetch;
function write600(path: string, value: string | Buffer): void {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}
function parts(publicKey: string): { m: string; e: string } {
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as {
    n?: string;
    e?: string;
  };
  return {
    m: Buffer.from(jwk.n ?? "", "base64url").toString("base64"),
    e: Buffer.from(jwk.e ?? "", "base64url").toString("base64"),
  };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "caf-bundle-"));
  const authority = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const files = new Map<number, { path: string; sha: string }>();
  for (const [type, to] of [
    [33, 5],
    [61, 4],
    [56, 2],
  ] as const) {
    const key = generateKeyPairSync("rsa", {
      modulusLength: 1024,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const rsa = parts(key.publicKey);
    const da = `<DA><RE>${RUT}</RE><RS>EMISOR FIXTURE</RS><TD>${type}</TD><RNG><D>1</D><H>${to}</H></RNG><FA>2026-07-20</FA><RSAPK><M>${rsa.m}</M><E>${rsa.e}</E></RSAPK><IDK>100</IDK></DA>`;
    const signer = createSign("RSA-SHA1");
    signer.update(Buffer.from(da, "latin1"));
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<AUTORIZACION><CAF version="1.0">${da}<FRMA algoritmo="SHA1withRSA">${signer.sign(authority.privateKey, "base64")}</FRMA></CAF><RSASK>${key.privateKey.trim()}</RSASK><RSAPUBK>${key.publicKey.trim()}</RSAPUBK></AUTORIZACION>\n`;
    const path = join(dir, `caf-${type}.xml`);
    write600(path, Buffer.from(xml, "latin1"));
    files.set(type, {
      path,
      sha: createHash("sha256").update(readFileSync(path)).digest("hex"),
    });
  }
  const contract = join(dir, "contract.json");
  write600(contract, JSON.stringify({ issuer: { rutEmisor: RUT } }));
  return { dir, files, contract };
}
function envFor(f: ReturnType<typeof fixture>): NodeJS.ProcessEnv {
  const get = (type: number) => f.files.get(type) ?? assert.fail("fixture");
  return {
    NODE_ENV: "test",
    DTE_MODE: "certification",
    DTE_SII_ENV: "certification",
    DTE_SII_LIVE_AUTH: "false",
    DTE_SII_ENABLE_SUBMIT: "false",
    DTE_SII_ENABLE_STATUS: "false",
    DTE_ALLOW_REAL_CAF_AUDIT: "true",
    DTE_ALLOW_MANUAL_CAF_PROVENANCE: "true",
    DTE_CAF_MANUAL_PROVENANCE_CONFIRM:
      "MAULLIN_CERTIFICATION_DOWNLOAD_REVIEWED",
    DTE_FACTURA_PRE_CAF_INPUT_PATH: f.contract,
    DTE_REAL_CAF_33_PATH: get(33).path,
    DTE_REAL_CAF_33_SHA256: get(33).sha,
    DTE_REAL_CAF_61_PATH: get(61).path,
    DTE_REAL_CAF_61_SHA256: get(61).sha,
    DTE_REAL_CAF_56_PATH: get(56).path,
    DTE_REAL_CAF_56_SHA256: get(56).sha,
  };
}
test("joint CAF audit accepts exact fixture bundle and emits only safe summary", () => {
  const f = fixture();
  const result = auditRealCertificationCafBundle(envFor(f));
  assert.equal(result.status, "READY_FOR_CERTIFICATION_OFFLINE");
  assert.deepEqual(
    result.cafs.map((caf) => [caf.type, caf.range]),
    [
      [33, "1-5"],
      [61, "1-4"],
      [56, "1-2"],
    ],
  );
  const output = formatRealCafBundleAudit(result);
  for (const secret of [
    RUT,
    "EMISOR FIXTURE",
    "RSASK",
    "RSAPUBK",
    "FRMA",
    "PRIVATE KEY",
  ])
    assert.equal(output.includes(secret), false);
  assert.match(output, /issuerMatch=valid/);
});
test("joint CAF audit fails closed for SHA, environment and network flags", () => {
  const f = fixture();
  assert.throws(
    () =>
      auditRealCertificationCafBundle({
        ...envFor(f),
        DTE_REAL_CAF_61_SHA256: "0".repeat(64),
      }),
    /field=sha256/,
  );
  assert.throws(
    () =>
      auditRealCertificationCafBundle({ ...envFor(f), NODE_ENV: "production" }),
    /field=NODE_ENV/,
  );
  for (const name of [
    "DTE_SII_LIVE_AUTH",
    "DTE_SII_ENABLE_SUBMIT",
    "DTE_SII_ENABLE_STATUS",
  ]) {
    assert.throws(
      () => auditRealCertificationCafBundle({ ...envFor(f), [name]: "true" }),
      /field=externalOperations/,
    );
  }
});
test("folio plan is exact and leaves one contingency folio per type", () => {
  const values = expectedCertificationFolioPlan();
  assert.deepEqual(Object.values(values), [1, 2, 3, 4, 1, 2, 3, 1]);
  assert.deepEqual(
    { type33: 5, type61: 4, type56: 2 },
    { type33: 5, type61: 4, type56: 2 },
  );
});
test("CAF bundle audit leaves global fetch unchanged", () => {
  assert.equal(globalThis.fetch, fetchBeforeBundleTests);
});
