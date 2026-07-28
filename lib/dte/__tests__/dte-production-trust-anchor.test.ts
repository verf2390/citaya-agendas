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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  flattenCafDaForFrma,
  loadProductionCafAuthorization,
  type CafTrustAnchor,
  type CafTrustStore,
} from "../certification/caf-secure-import";

const ISSUER_RUT = "76086428-5";
const IDK = "100";
const OFFICIAL_FIXTURE_PROVENANCE =
  "official:https://www.sii.cl/test-fixture-only";

type Fixture = {
  dir: string;
  cafPath: string;
  xml: string;
  authorityPath: string;
  authoritySha256: string;
};

function secureWrite(path: string, bytes: string | Buffer): void {
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function publicParts(publicKey: string) {
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

function createFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "dte-production-anchor-"));
  const authority = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const taxpayer = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const parts = publicParts(taxpayer.publicKey);
  const da =
    `<DA><RE>${ISSUER_RUT}</RE><RS>EMISOR TEST</RS><TD>33</TD>` +
    `<RNG><D>1</D><H>5</H></RNG><FA>2026-07-20</FA>` +
    `<RSAPK><M>${parts.modulus}</M><E>${parts.exponent}</E></RSAPK>` +
    `<IDK>${IDK}</IDK></DA>`;
  const signer = createSign("RSA-SHA1");
  signer.update(Buffer.from(da, "latin1"));
  const frma = signer.sign(authority.privateKey, "base64");
  const xml =
    '<?xml version="1.0" encoding="ISO-8859-1"?>\n' +
    `<AUTORIZACION><CAF version="1.0">${da}` +
    `<FRMA algoritmo="SHA1withRSA">${frma}</FRMA></CAF>` +
    `<RSASK>${taxpayer.privateKey.trim()}</RSASK>` +
    `<RSAPUBK>${taxpayer.publicKey.trim()}</RSAPUBK></AUTORIZACION>\n`;
  const cafPath = join(dir, "caf.xml");
  const authorityPath = join(dir, "sii-authority-fixture.pem");
  secureWrite(cafPath, Buffer.from(xml, "latin1"));
  secureWrite(authorityPath, authority.publicKey);
  return {
    dir,
    cafPath,
    xml,
    authorityPath,
    authoritySha256: createHash("sha256")
      .update(readFileSync(authorityPath))
      .digest("hex"),
  };
}

function trustStore(
  fixture: Fixture,
  overrides: Partial<CafTrustAnchor> = {},
): CafTrustStore {
  return new Map([
    [
      IDK,
      {
        idk: IDK,
        mode: "real",
        publicKeyPath: fixture.authorityPath,
        provenance: OFFICIAL_FIXTURE_PROVENANCE,
        sha256: fixture.authoritySha256,
        ...overrides,
      },
    ],
  ]);
}

function load(
  fixture: Fixture,
  store: CafTrustStore,
  path = fixture.cafPath,
) {
  return loadProductionCafAuthorization(path, {
    repoRoot: process.cwd(),
    expectedIssuerRut: ISSUER_RUT,
    expectedType: 33,
    expectedRange: { from: 1, to: 5 },
    minimumAvailable: 4,
    trustStore: store,
    expectedOwnerUid: process.getuid?.(),
  });
}

test("FRMA flattens only inter-tag whitespace and preserves entities", () => {
  const da =
    "<DA>\n  <RE>76086428-5</RE>\n  <RS>R&amp;G SPA</RS>\n" +
    "  <TD>33</TD>\n</DA>";
  assert.equal(
    flattenCafDaForFrma(da).toString("latin1"),
    "<DA><RE>76086428-5</RE><RS>R&amp;G SPA</RS><TD>33</TD></DA>",
  );
});

function mutation(fixture: Fixture, from: string, to: string): string {
  const path = join(
    mkdtempSync(join(tmpdir(), "dte-production-anchor-mutated-")),
    "caf.xml",
  );
  secureWrite(path, Buffer.from(fixture.xml.replace(from, to), "latin1"));
  return path;
}

test("production CAF rejects an unknown IDK", () => {
  const fixture = createFixture();
  assert.throws(
    () =>
      load(
        fixture,
        trustStore(fixture),
        mutation(fixture, "<IDK>100</IDK>", "<IDK>101</IDK>"),
      ),
    /field=IDK/,
  );
});

test("production CAF rejects a missing trust anchor", () => {
  const fixture = createFixture();
  assert.throws(() => load(fixture, new Map()), /field=IDK/);
});

test("production CAF rejects a wrong pinned SHA-256", () => {
  const fixture = createFixture();
  assert.throws(
    () => load(fixture, trustStore(fixture, { sha256: "0".repeat(64) })),
    /field=trustAnchor\.sha256/,
  );
});

test("production CAF rejects non-official provenance", () => {
  const fixture = createFixture();
  assert.throws(
    () =>
      load(
        fixture,
        trustStore(fixture, {
          provenance: "official:https://example.test/not-sii",
        }),
      ),
    /field=trustAnchor\.provenance/,
  );
});

test("production CAF rejects invalid FRMA", () => {
  const fixture = createFixture();
  const unrelated = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const unrelatedPath = join(fixture.dir, "unrelated-anchor.pem");
  secureWrite(unrelatedPath, unrelated.publicKey);
  assert.throws(
    () =>
      load(
        fixture,
        trustStore(fixture, {
          publicKeyPath: unrelatedPath,
          sha256: createHash("sha256")
            .update(readFileSync(unrelatedPath))
            .digest("hex"),
        }),
      ),
    /field=FRMA/,
  );
});

test("production CAF rejects taxpayer RSAPK used as SII anchor", () => {
  const fixture = createFixture();
  const taxpayerPublicKey = fixture.xml.match(
    /<RSAPUBK>([\s\S]*?)<\/RSAPUBK>/,
  )?.[1];
  assert.ok(taxpayerPublicKey);
  const taxpayerPath = join(fixture.dir, "taxpayer-not-anchor.pem");
  secureWrite(taxpayerPath, `${taxpayerPublicKey.trim()}\n`);
  assert.throws(
    () =>
      load(
        fixture,
        trustStore(fixture, {
          publicKeyPath: taxpayerPath,
          sha256: createHash("sha256")
            .update(readFileSync(taxpayerPath))
            .digest("hex"),
        }),
      ),
    /field=trustAnchor\.role/,
  );
});

test("production CAF accepts a matching pinned anchor only", () => {
  const fixture = createFixture();
  const loaded = load(fixture, trustStore(fixture));
  assert.equal(loaded.idk, IDK);
  assert.equal(loaded.trustStatus, "verified_official");
  assert.equal(loaded.materialKind, "production_real");
  assert.equal(loaded.realUseBlocked, false);
});
