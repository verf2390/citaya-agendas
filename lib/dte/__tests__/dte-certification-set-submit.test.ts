import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import Database from "better-sqlite3";
import {
  ControlledSetSubmitError,
  formatSubmitError,
  preflightCertificationSetSubmit,
  submitPreparedCertificationSet,
} from "../certification/factura-certification-set-submit";

function write600(path: string, value: string | Buffer) {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "set-submit-"));
  const envelope = join(root, "EnvioDTE-4959698-CERTIFICATION.xml");
  const xml =
    '<?xml version="1.0" encoding="ISO-8859-1"?><EnvioDTE>FIXTURE</EnvioDTE>';
  write600(envelope, Buffer.from(xml, "latin1"));
  const sha = createHash("sha256").update(readFileSync(envelope)).digest("hex");
  const cert = join(root, "cert.pem"),
    key = join(root, "key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      cert,
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=Fixture/serialNumber=11111111-1/C=CL",
    ],
    { stdio: "ignore" },
  );
  chmodSync(cert, 0o600);
  chmodSync(key, 0o600);
  const manifest = join(root, "manifest-4959698-CERTIFICATION.json");
  const files: Array<{ file: string; sha256: string }> = [];
  for (let index = 1; index <= 8; index += 1) {
    const file = `4959698-${index}-DTE-CERTIFICATION.xml`;
    const value = Buffer.from(`fixture-${index}`, "latin1");
    write600(join(root, file), value);
    files.push({
      file,
      sha256: createHash("sha256").update(value).digest("hex"),
    });
  }
  files.push({ file: "EnvioDTE-4959698-CERTIFICATION.xml", sha256: sha });
  write600(manifest, JSON.stringify({ fixtureMode: false, files }));
  const ledger = join(root, "ledger.sqlite");
  const db = new Database(ledger);
  db.exec(
    "CREATE TABLE folios(type_code INTEGER,folio INTEGER,state TEXT,reserved_case TEXT)",
  );
  const insert = db.prepare("INSERT INTO folios VALUES(?,?,?,?)");
  const plan = [
    [33, 1, 1],
    [33, 2, 2],
    [33, 3, 3],
    [33, 4, 4],
    [61, 1, 5],
    [61, 2, 6],
    [61, 3, 7],
    [56, 1, 8],
  ];
  for (const [t, n, c] of plan)
    insert.run(t, n, "issued", `SET-4959698-ATTEMPT-001:4959698-${c}`);
  for (const [t, n] of [
    [33, 5],
    [61, 4],
    [56, 2],
  ])
    insert.run(t, n, "available", null);
  db.close();
  chmodSync(ledger, 0o600);
  const registry = join(root, "registry");
  const env: NodeJS.ProcessEnv = {
    DTE_MODE: "certification",
    DTE_SII_ENV: "certification",
    NODE_ENV: "test",
    DTE_SII_LIVE_AUTH: "true",
    DTE_SII_ENABLE_SUBMIT: "true",
    DTE_SII_ENABLE_STATUS: "false",
    DTE_FACTURA_CERTIFICATION_ENVELOPE_SHA256: sha,
    DTE_FACTURA_CERTIFICATION_SUBMIT_CONFIRM: `SUBMIT_SET_4959698_${sha}`,
    DTE_SII_SUBMIT_URL: "https://maullin.sii.cl/cgi_dte/UPL/DTEUpload",
    DTE_FACTURA_CERTIFICATION_ENVELOPE_PATH: envelope,
    DTE_FACTURA_CERTIFICATION_MANIFEST_PATH: manifest,
    DTE_FACTURA_CERTIFICATION_LEDGER_PATH: ledger,
    DTE_FACTURA_CERTIFICATION_SUBMIT_REGISTRY_DIR: registry,
    DTE_CERT_PATH: cert,
    DTE_PRIVATE_KEY_PATH: key,
    SII_RUT_EMPRESA: "11111111-1",
    SII_RUT_USUARIO: "22222222-2",
  };
  return { root, envelope, sha, env, registry };
}
const deps = (sha: string) => ({
  expectedSha256: sha,
  xsd: () => true,
  signature: () => true,
});
test("offline preflight validates fixture without fetch", () => {
  const f = fixture();
  let calls = 0;
  const old = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("NETWORK_FORBIDDEN");
  };
  try {
    const result = preflightCertificationSetSubmit(
      f.env,
      process.cwd(),
      deps(f.sha),
    );
    assert.equal(result.envelopeSha256, f.sha);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old;
  }
});
test("preflight rejects endpoint, production, confirmation and flags", () => {
  for (const patch of [
    { DTE_SII_SUBMIT_URL: "https://example.invalid/upload" },
    { NODE_ENV: "production" },
    { DTE_FACTURA_CERTIFICATION_SUBMIT_CONFIRM: "wrong" },
    { DTE_SII_ENABLE_STATUS: "true" },
    { DTE_SII_ENABLE_SUBMIT: "false" },
    { DTE_SII_LIVE_AUTH: "false" },
  ]) {
    const f = fixture();
    assert.throws(
      () =>
        preflightCertificationSetSubmit(
          { ...f.env, ...patch },
          process.cwd(),
          deps(f.sha),
        ),
      ControlledSetSubmitError,
    );
  }
});
test("preflight rejects wrong hash and modified envelope", () => {
  const a = fixture();
  assert.throws(() =>
    preflightCertificationSetSubmit(
      { ...a.env, DTE_FACTURA_CERTIFICATION_ENVELOPE_SHA256: "0".repeat(64) },
      process.cwd(),
      deps(a.sha),
    ),
  );
  const b = fixture();
  write600(
    b.envelope,
    Buffer.from(
      '<?xml version="1.0" encoding="ISO-8859-1"?><EnvioDTE>CHANGED</EnvioDTE>',
      "latin1",
    ),
  );
  assert.throws(
    () => preflightCertificationSetSubmit(b.env, process.cwd(), deps(b.sha)),
    /Controlled certification/,
  );
});
test("preflight rejects permissions, symlink and internal path", () => {
  const a = fixture();
  chmodSync(a.envelope, 0o644);
  assert.throws(() =>
    preflightCertificationSetSubmit(a.env, process.cwd(), deps(a.sha)),
  );
  const b = fixture();
  const link = join(b.root, "link.xml");
  symlinkSync(b.envelope, link);
  assert.throws(() =>
    preflightCertificationSetSubmit(
      { ...b.env, DTE_FACTURA_CERTIFICATION_ENVELOPE_PATH: link },
      process.cwd(),
      deps(b.sha),
    ),
  );
  const c = fixture();
  assert.throws(() =>
    preflightCertificationSetSubmit(c.env, c.root, deps(c.sha)),
  );
});
function responses(kind: "success" | "rejected" | "timeout") {
  let calls = 0;
  const bodies: unknown[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls++;
    bodies.push(init?.body);
    if (calls === 1)
      return new Response(
        "<RESPUESTA><RESP_HDR><ESTADO>00</ESTADO></RESP_HDR><RESP_BODY><SEMILLA>12345</SEMILLA></RESP_BODY></RESPUESTA>",
        { status: 200 },
      );
    if (calls === 2)
      return new Response(
        "<RESPUESTA><RESP_HDR><ESTADO>00</ESTADO></RESP_HDR><RESP_BODY><TOKEN>fixture-token-secret</TOKEN></RESP_BODY></RESPUESTA>",
        { status: 200 },
      );
    if (kind === "timeout") throw new DOMException("timeout", "TimeoutError");
    return new Response(
      kind === "success"
        ? "<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>123456789</TRACKID></RECEPCIONDTE>"
        : "<RECEPCIONDTE><STATUS>5</STATUS></RECEPCIONDTE>",
      { status: 200 },
    );
  };
  return {
    fetchImpl,
    bodies,
    get calls() {
      return calls;
    },
  };
}
test("submit builds official multipart, accepts STATUS 0, stores track and never queries status", async () => {
  const f = fixture();
  const mock = responses("success");
  const result = await submitPreparedCertificationSet(f.env, {
    ...deps(f.sha),
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(mock.calls, 3);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(result.trackIdStored, true);
  assert.equal(result.statusQueried, false);
  const form = mock.bodies[2] as FormData;
  assert.equal(form.get("rutSender"), "22222222");
  assert.equal(form.get("dvSender"), "2");
  assert.equal(form.get("rutCompany"), "11111111");
  assert.equal(form.get("dvCompany"), "1");
  assert.ok(form.get("archivo") instanceof Blob);
  const record = JSON.parse(
    readFileSync(join(f.registry, `${f.sha}.json`), "utf8"),
  );
  assert.equal(record.state, "submitted");
  assert.equal(record.trackId, "123456789");
  assert.throws(
    () => preflightCertificationSetSubmit(f.env, process.cwd(), deps(f.sha)),
    /Controlled certification/,
  );
});
test("rejected response is persisted and blocks a second submit", async () => {
  const f = fixture();
  const mock = responses("rejected");
  const result = await submitPreparedCertificationSet(f.env, {
    ...deps(f.sha),
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.submitted, false);
  await assert.rejects(() =>
    submitPreparedCertificationSet(f.env, {
      ...deps(f.sha),
      fetchImpl: mock.fetchImpl,
    }),
  );
  assert.equal(mock.calls, 3);
});
test("upload timeout becomes ambiguous and cannot retry", async () => {
  const f = fixture();
  const mock = responses("timeout");
  await assert.rejects(
    () =>
      submitPreparedCertificationSet(f.env, {
        ...deps(f.sha),
        fetchImpl: mock.fetchImpl,
      }),
    (error) =>
      error instanceof ControlledSetSubmitError && error.field === "ambiguous",
  );
  const record = JSON.parse(
    readFileSync(join(f.registry, `${f.sha}.json`), "utf8"),
  );
  assert.equal(record.state, "ambiguous");
  await assert.rejects(() =>
    submitPreparedCertificationSet(f.env, {
      ...deps(f.sha),
      fetchImpl: mock.fetchImpl,
    }),
  );
  assert.equal(mock.calls, 3);
});
test("safe errors never print internal values", () => {
  const secret = "TOKEN track-id RUT XML /secure/path PRIVATE KEY";
  const output = formatSubmitError(
    new ControlledSetSubmitError("submit", "ambiguous", new Error(secret)),
  );
  for (const value of secret.split(" "))
    assert.equal(output.includes(value), false);
  assert.match(output, /stage=submit/);
});
