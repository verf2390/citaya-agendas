import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  createSign,
  generateKeyPairSync,
} from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  auditRealCertificationCaf,
  printRealCafAudit,
} from "../certification/caf-real-audit";
import {
  loadCafAuthorization,
  type CafTrustStore,
} from "../certification/caf-secure-import";

const ISSUER_RUT = "76086428-5";
const IDK = "100";

const fetchBeforeRealCafAuditTests = globalThis.fetch;

type Fixture = {
  dir: string;
  cafPath: string;
  contractPath: string;
  anchorPath: string;
  anchorHash: string;
  sha256: string;
  xml: string;
};

function publicParts(publicKey: string): { modulus: string; exponent: string } {
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as {
    n?: string;
    e?: string;
  };
  assert.ok(jwk.n && jwk.e);
  return {
    modulus: Buffer.from(jwk.n, "base64url").toString("base64"),
    exponent: Buffer.from(jwk.e, "base64url").toString("base64"),
  };
}
function secureWrite(path: string, bytes: string | Buffer): void {
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
}
function createFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "caf-real-audit-fixture-"));
  const authority = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const cafKeys = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const parts = publicParts(cafKeys.publicKey);
  const da = `<DA><RE>${ISSUER_RUT}</RE><RS>EMISOR CERTIFICACION TEST</RS><TD>33</TD><RNG><D>1</D><H>5</H></RNG><FA>2026-07-20</FA><RSAPK><M>${parts.modulus}</M><E>${parts.exponent}</E></RSAPK><IDK>${IDK}</IDK></DA>`;
  const signer = createSign("RSA-SHA1");
  signer.update(Buffer.from(da, "latin1"));
  const frma = signer.sign(authority.privateKey, "base64");
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<AUTORIZACION><CAF version="1.0">${da}<FRMA algoritmo="SHA1withRSA">${frma}</FRMA></CAF><RSASK>${cafKeys.privateKey.trim()}</RSASK><RSAPUBK>${cafKeys.publicKey.trim()}</RSAPUBK></AUTORIZACION>\n`;
  const cafPath = join(dir, "caf-generated.xml");
  const contractPath = join(dir, "contract.json");
  const anchorPath = join(dir, "official-anchor-fixture.pem");
  secureWrite(cafPath, Buffer.from(xml, "latin1"));
  secureWrite(
    contractPath,
    JSON.stringify({ issuer: { rutEmisor: ISSUER_RUT } }),
  );
  secureWrite(anchorPath, authority.publicKey);
  return {
    dir,
    cafPath,
    contractPath,
    anchorPath,
    anchorHash: createHash("sha256")
      .update(readFileSync(anchorPath))
      .digest("hex"),
    sha256: createHash("sha256").update(readFileSync(cafPath)).digest("hex"),
    xml,
  };
}
function envFor(fixture: Fixture): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DTE_MODE: "certification",
    DTE_SII_ENV: "certification",
    DTE_ALLOW_REAL_CAF_AUDIT: "true",
    DTE_REAL_CAF_PATH: fixture.cafPath,
    DTE_REAL_CAF_EXPECTED_SHA256: fixture.sha256,
    DTE_FACTURA_PRE_CAF_INPUT_PATH: fixture.contractPath,
    DTE_SII_ENABLE_SUBMIT: "false",
    DTE_SII_ENABLE_STATUS: "false",
    DTE_SII_LIVE_AUTH: "false",
  };
}
function manualEnvFor(fixture: Fixture): NodeJS.ProcessEnv {
  return {
    ...envFor(fixture),
    DTE_ALLOW_MANUAL_CAF_PROVENANCE: "true",
    DTE_CAF_MANUAL_PROVENANCE_CONFIRM:
      "MAULLIN_CERTIFICATION_DOWNLOAD_REVIEWED",
  };
}
function mutated(
  fixture: Fixture,
  transform: (xml: string) => string,
): {
  path: string;
  sha256: string;
} {
  const path = join(
    mkdtempSync(join(tmpdir(), "caf-real-audit-mutated-")),
    "caf.xml",
  );
  secureWrite(path, Buffer.from(transform(fixture.xml), "latin1"));
  return {
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

test("real CAF audit passes local checks but blocks without official anchor and never uses network", () => {
  const fixture = createFixture();
  const result = auditRealCertificationCaf(envFor(fixture), process.cwd());
    assert.equal(result.status, "BLOCKED_TRUST_ANCHOR");
    assert.equal(result.officialSiiTrustAnchor, "pending");
    assert.equal(result.fixtureKey, false);
    assert.equal(result.realUseBlocked, true);
    assert.equal(result.ledgerImported, false);
    assert.equal(result.foliosReserved, 0);
    assert.equal(result.dteGenerated, false);
  assert.equal(result.siiContacted, false);
});

test("real CAF audit accepts only a complete pinned official external anchor", () => {
  const fixture = createFixture();
  const result = auditRealCertificationCaf(
    {
      ...envFor(fixture),
      DTE_SII_TRUST_ANCHOR_IDK: IDK,
      DTE_SII_TRUST_ANCHOR_PATH: fixture.anchorPath,
      DTE_SII_TRUST_ANCHOR_PROVENANCE: "official:test-fixture-only",
      DTE_SII_TRUST_ANCHOR_SHA256: fixture.anchorHash,
    },
    process.cwd(),
  );
  assert.equal(result.status, "VERIFIED_LOCAL_AND_OFFICIAL");
  assert.equal(result.officialSiiTrustAnchor, "verified");
});

test("real CAF audit rejects checksum, permissions, symlink and repository path", () => {
  const fixture = createFixture();
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...envFor(fixture),
        DTE_REAL_CAF_EXPECTED_SHA256: "0".repeat(64),
      }),
    /field=sha256/,
  );
  chmodSync(fixture.cafPath, 0o640);
  assert.throws(
    () => auditRealCertificationCaf(envFor(fixture)),
    /field=permissions/,
  );
  chmodSync(fixture.cafPath, 0o600);
  const link = join(
    mkdtempSync(join(tmpdir(), "caf-real-audit-link-")),
    "caf.xml",
  );
  symlinkSync(fixture.cafPath, link);
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...envFor(fixture),
        DTE_REAL_CAF_PATH: link,
      }),
    /field=path/,
  );
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...envFor(fixture),
        DTE_REAL_CAF_PATH: __filename,
      }),
    /field=path/,
  );
});

test("real CAF audit rejects issuer, type and exact range mismatches", () => {
  const fixture = createFixture();
  secureWrite(
    fixture.contractPath,
    JSON.stringify({ issuer: { rutEmisor: "76192083-9" } }),
  );
  assert.throws(() => auditRealCertificationCaf(envFor(fixture)), /field=RE/);
  secureWrite(
    fixture.contractPath,
    JSON.stringify({ issuer: { rutEmisor: ISSUER_RUT } }),
  );
  for (const [transform, field] of [
    [(xml: string) => xml.replace("<TD>33</TD>", "<TD>34</TD>"), "TD"],
    [(xml: string) => xml.replace("<H>5</H>", "<H>4</H>"), "RNG.expected"],
  ] as const) {
    const changed = mutated(fixture, transform);
    assert.throws(
      () =>
        auditRealCertificationCaf({
          ...envFor(fixture),
          DTE_REAL_CAF_PATH: changed.path,
          DTE_REAL_CAF_EXPECTED_SHA256: changed.sha256,
        }),
      new RegExp(`field=${field.replace(".", "\\.")}`),
    );
  }
});

test("real CAF audit rejects mismatched private/public and DA public keys", () => {
  const fixture = createFixture();
  const other = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const mismatch = mutated(fixture, (xml) =>
    xml.replace(
      /<RSAPUBK>[\s\S]*<\/RSAPUBK>/,
      `<RSAPUBK>${other.publicKey.trim()}</RSAPUBK>`,
    ),
  );
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...envFor(fixture),
        DTE_REAL_CAF_PATH: mismatch.path,
        DTE_REAL_CAF_EXPECTED_SHA256: mismatch.sha256,
      }),
    /field=RSASK\/RSAPUBK/,
  );
  const daMismatch = mutated(fixture, (xml) => xml.replace(/(<M>)(.)/, "$1A"));
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...envFor(fixture),
        DTE_REAL_CAF_PATH: daMismatch.path,
        DTE_REAL_CAF_EXPECTED_SHA256: daMismatch.sha256,
      }),
    /field=RSAPK/,
  );
});

test("encoding rules distinguish ASCII ambiguity from declared Latin-1", () => {
  const fixture = createFixture();
  const noEncodingAscii = mutated(fixture, (xml) =>
    xml.replace(' encoding="ISO-8859-1"', ""),
  );
  const asciiResult = auditRealCertificationCaf({
    ...envFor(fixture),
    DTE_REAL_CAF_PATH: noEncodingAscii.path,
    DTE_REAL_CAF_EXPECTED_SHA256: noEncodingAscii.sha256,
  });
  assert.equal(asciiResult.status, "BLOCKED_TRUST_ANCHOR");

  const noEncodingLatin1 = mutated(fixture, (xml) =>
    xml
      .replace(' encoding="ISO-8859-1"', "")
      .replace("EMISOR CERTIFICACION TEST", "EMISOR CERTIFICACIÓN TEST"),
  );
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...envFor(fixture),
        DTE_REAL_CAF_PATH: noEncodingLatin1.path,
        DTE_REAL_CAF_EXPECTED_SHA256: noEncodingLatin1.sha256,
      }),
    /field=encoding\.ambiguous/,
  );

  const declaredLatin1 = mutated(fixture, (xml) =>
    xml.replace("EMISOR CERTIFICACION TEST", "EMISOR CERTIFICACIÓN TEST"),
  );
  assert.equal(
    auditRealCertificationCaf({
      ...envFor(fixture),
      DTE_REAL_CAF_PATH: declaredLatin1.path,
      DTE_REAL_CAF_EXPECTED_SHA256: declaredLatin1.sha256,
    }).status,
    "BLOCKED_TRUST_ANCHOR",
  );

  for (const encoding of ["UTF-8", "Windows-1252"]) {
    const changed = mutated(fixture, (xml) =>
      xml.replace("ISO-8859-1", encoding),
    );
    assert.throws(
      () =>
        auditRealCertificationCaf({
          ...envFor(fixture),
          DTE_REAL_CAF_PATH: changed.path,
          DTE_REAL_CAF_EXPECTED_SHA256: changed.sha256,
        }),
      /field=encoding/,
    );
  }
});

test("public audit output excludes issuer identifiers and cryptographic material", () => {
  const fixture = createFixture();
  const result = auditRealCertificationCaf(manualEnvFor(fixture));
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    printRealCafAudit(result);
  } finally {
    console.log = originalLog;
  }
  const rendered = output.join("\n");
  const issuerHash = createHash("sha256").update(ISSUER_RUT).digest("hex");
  const forbidden = [
    ISSUER_RUT,
    issuerHash,
    "EMISOR CERTIFICACION TEST",
    "RSASK",
    "RSAPUBK",
    "FRMA",
    publicParts(fixture.xml.match(/<RSAPUBK>([\s\S]*?)<\/RSAPUBK>/)?.[1] ?? "")
      .modulus,
  ];
  for (const value of forbidden) assert.equal(rendered.includes(value), false);
  assert.match(rendered, /issuerMatch=valid/);
  assert.match(rendered, /manualProvenance=accepted/);
  assert.match(rendered, /trustVerified=false/);
  assert.match(rendered, /certificationOfflineUseAllowed=true/);
  assert.match(rendered, /productionUseBlocked=true/);
});

test("manual provenance requires exact confirmation and certification-only environment", () => {
  const fixture = createFixture();
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...envFor(fixture),
        DTE_ALLOW_MANUAL_CAF_PROVENANCE: "true",
      }),
    /field=manualProvenance\.confirmation/,
  );
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...manualEnvFor(fixture),
        DTE_CAF_MANUAL_PROVENANCE_CONFIRM: "WRONG",
      }),
    /field=manualProvenance\.confirmation/,
  );
  for (const [name, value] of [
    ["DTE_MODE", "production"],
    ["DTE_SII_ENV", "production"],
  ] as const) {
    assert.throws(
      () =>
        auditRealCertificationCaf({ ...manualEnvFor(fixture), [name]: value }),
      /field=environment/,
    );
  }
});

test("exact manual provenance configuration enables only certification offline use", () => {
  const fixture = createFixture();
  const result = auditRealCertificationCaf(manualEnvFor(fixture));
  assert.equal(result.status, "READY_FOR_CERTIFICATION_OFFLINE");
  assert.equal(result.manualProvenance, "accepted");
  assert.equal(result.officialSiiTrustAnchor, "pending");
  assert.equal(result.trustVerified, false);
  assert.equal(result.certificationOfflineUseAllowed, true);
  assert.equal(result.productionUseBlocked, true);
  assert.equal(result.realUseBlocked, true);
  assert.equal(result.siiContacted, false);
  assert.equal(result.ledgerImported, false);
  assert.equal(result.foliosReserved, 0);
  assert.equal(result.dteGenerated, false);
});

test("manual provenance never masks IDK, owner or supplied-anchor failures", () => {
  const fixture = createFixture();
  const wrongIdk = mutated(fixture, (xml) =>
    xml.replace("<IDK>100</IDK>", "<IDK>101</IDK>"),
  );
  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...manualEnvFor(fixture),
        DTE_REAL_CAF_PATH: wrongIdk.path,
        DTE_REAL_CAF_EXPECTED_SHA256: wrongIdk.sha256,
      }),
    /field=IDK/,
  );

  const trust: CafTrustStore = new Map();
  assert.throws(
    () =>
      loadCafAuthorization(fixture.cafPath, {
        repoRoot: process.cwd(),
        expectedIssuerRut: ISSUER_RUT,
        expectedType: 33,
        expectedRange: { from: 1, to: 5 },
        expectedIdk: "100",
        minimumAvailable: 4,
        expectedOwnerUid: (process.getuid?.() ?? 0) + 1,
        trustStore: trust,
        fixtureMode: false,
        materialKind: "certification_real",
        allowPendingOfficialTrustAnchor: true,
      }),
    /field=owner/,
  );

  assert.throws(
    () =>
      auditRealCertificationCaf({
        ...manualEnvFor(fixture),
        DTE_SII_TRUST_ANCHOR_IDK: IDK,
        DTE_SII_TRUST_ANCHOR_PATH: fixture.anchorPath,
        DTE_SII_TRUST_ANCHOR_PROVENANCE: "official:test-fixture-only",
        DTE_SII_TRUST_ANCHOR_SHA256: "0".repeat(64),
      }),
    /field=trustAnchor\.sha256/,
  );
});

test("production runtime and external operation flags remain blocked", () => {
  const fixture = createFixture();
  assert.throws(
    () =>
      auditRealCertificationCaf({ ...envFor(fixture), NODE_ENV: "production" }),
    /field=NODE_ENV/,
  );
  for (const [name, value] of [
    ["DTE_SII_ENABLE_SUBMIT", "true"],
    ["DTE_SII_ENABLE_STATUS", "true"],
    ["DTE_SII_LIVE_AUTH", "true"],
    ["DTE_SII_TOKEN", "present"],
    ["DTE_TRACK_ID", "present"],
  ] as const) {
    assert.throws(
      () =>
        auditRealCertificationCaf({ ...manualEnvFor(fixture), [name]: value }),
      /field=externalOperations/,
    );
  }
});

test("fixture and production material classifications cannot be confused", () => {
  const fixture = createFixture();
  const trust: CafTrustStore = new Map([
    [
      IDK,
      {
        idk: IDK,
        mode: "fixture",
        publicKeyPath: fixture.anchorPath,
        provenance: "generated:test",
        sha256: fixture.anchorHash,
      },
    ],
  ]);
  const loaded = loadCafAuthorization(fixture.cafPath, {
    repoRoot: process.cwd(),
    expectedIssuerRut: ISSUER_RUT,
    expectedType: 33,
    expectedRange: { from: 1, to: 5 },
    minimumAvailable: 4,
    trustStore: trust,
    fixtureMode: true,
    materialKind: "fixture",
  });
  assert.equal(loaded.fixtureKey, true);
  assert.equal(loaded.trustStatus, "verified_fixture");
  assert.throws(
    () =>
      loadCafAuthorization(fixture.cafPath, {
        repoRoot: process.cwd(),
        expectedIssuerRut: ISSUER_RUT,
        expectedType: 33,
        minimumAvailable: 4,
        trustStore: new Map(),
        fixtureMode: false,
        materialKind: "production_real",
      }),
    /field=production/,
  );
});

test("real CAF audit leaves global fetch unchanged", () => {
  assert.equal(globalThis.fetch, fetchBeforeRealCafAuditTests);
});
