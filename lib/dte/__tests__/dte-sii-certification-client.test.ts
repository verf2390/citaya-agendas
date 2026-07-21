import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateDteConfig } from "../config/validate-dte-config";
import { buildSubmissionRecord } from "../persistence/dte-submissions";
import {
  getSiiCertificationConfigFromEnv,
  signSeed,
} from "../sii/sii-certification-client";
import {
  SII_CERTIFICATION_SEED_URL,
  SII_CERTIFICATION_TOKEN_URL,
  XMLDSIG_C14N,
  XMLDSIG_ENVELOPED_SIGNATURE,
  XMLDSIG_RSA_SHA1,
  XMLDSIG_SHA1,
  buildGetSeedSoapEnvelope,
  buildGetTokenSoapEnvelope,
  buildSiiSeedKeyInfoContent,
  buildGetTokenXml,
  parseSeedSoapResponse,
  parseTokenSoapResponse,
  requestSeed,
  requestToken,
  verifySignedSeedXml,
} from "../sii/sii-auth";
import { SII_ERROR_CODES, SiiCertificationError } from "../sii/sii-errors";
import {
  mapRawSiiStatus,
  mapSiiStatusToInternalStatus,
  parseSiiStatusResponse,
  parseSiiSubmissionResponse,
} from "../sii/sii-status";


function createSelfSignedFixture(root: string) {
  const keyPath = join(root, "auth-private-key.pem");
  const certPath = join(root, "auth-cert.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Citaya Auth Fixture/serialNumber=11111111-1/C=CL",
  ], { stdio: "ignore" });
  return {
    privateKeyPem: readFileSync(keyPath, "utf8"),
    certificatePem: readFileSync(certPath, "utf8"),
    keyPath,
    certPath,
  };
}

function authConfig(overrides = {}) {
  return {
    environment: "certification" as const,
    seedUrl: SII_CERTIFICATION_SEED_URL,
    tokenUrl: SII_CERTIFICATION_TOKEN_URL,
    submitUrl: "",
    statusUrl: "",
    rutEmpresa: "78195645-7",
    rutUsuario: "27164542-2",
    timeoutMs: 30_000,
    enableSubmit: false,
    ...overrides,
  };
}

test("builds SII SOAP seed envelope without WSDL endpoint", () => {
  const envelope = buildGetSeedSoapEnvelope();

  assert.match(envelope, /Envelope/);
  assert.match(envelope, /getSeed/);
  assert.doesNotMatch(SII_CERTIFICATION_SEED_URL, /\?WSDL/);
  assert.doesNotMatch(SII_CERTIFICATION_TOKEN_URL, /\?WSDL/);
});

test("builds getToken XML preserving seed leading zeroes", () => {
  const xml = buildGetTokenXml("0000012345");

  assert.match(xml, /^<\?xml version="1\.0"\?>/);
  assert.match(xml, /<getToken>/);
  assert.match(xml, /<Semilla>0000012345<\/Semilla>/);
});

test("signs getToken XML with verifiable XMLDSig and X509 KeyInfo", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-sii-auth-xmldsig-"));
  const { privateKeyPem, certificatePem } = createSelfSignedFixture(root);
  const result = signSeed("0000012345", authConfig(), { privateKeyPem, certificatePem });

  assert.equal(result.ok, true);
  assert.ok(result.signedXml);
  assert.match(result.signedXml ?? "", /<Semilla>0000012345<\/Semilla>/);
  assert.match(result.signedXml ?? "", new RegExp(XMLDSIG_C14N));
  assert.match(result.signedXml ?? "", new RegExp(XMLDSIG_RSA_SHA1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.signedXml ?? "", new RegExp(XMLDSIG_ENVELOPED_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.signedXml ?? "", new RegExp(XMLDSIG_SHA1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.signedXml ?? "", /<X509Certificate>/);
  assert.equal(verifySignedSeedXml(result.signedXml ?? "", certificatePem), true);
  assert.doesNotMatch(result.signedXml ?? "", /PRIVATE KEY/);
});

test("parses SOAP seed response and preserves leading zeroes", async () => {
  const soap = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><getSeedResponse><getSeedReturn>&lt;RESPUESTA&gt;&lt;RESP_HDR&gt;&lt;ESTADO&gt;00&lt;/ESTADO&gt;&lt;GLOSA&gt;OK&lt;/GLOSA&gt;&lt;/RESP_HDR&gt;&lt;RESP_BODY&gt;&lt;SEMILLA&gt;0000009876&lt;/SEMILLA&gt;&lt;/RESP_BODY&gt;&lt;/RESPUESTA&gt;</getSeedReturn></getSeedResponse></soap:Body></soap:Envelope>`;
  const parsed = parseSeedSoapResponse(soap);

  assert.equal(parsed.estado, "00");
  assert.equal(parsed.glosa, "OK");
  assert.equal(parsed.semilla, "0000009876");

  const result = await requestSeed(authConfig(), {
    fetchImpl: async (_url, init) => {
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /getSeed/);
      return new Response(soap, { status: 200 });
    },
  });
  assert.equal(result.seed, "0000009876");
});

test("parses SOAP token response and fingerprints token without logging it", async () => {
  const tokenValue = "TOKEN-COMPLETO-SECRETO";
  const soap = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><getTokenResponse><getTokenReturn>&lt;RESPUESTA&gt;&lt;RESP_HDR&gt;&lt;ESTADO&gt;00&lt;/ESTADO&gt;&lt;GLOSA&gt;OK&lt;/GLOSA&gt;&lt;/RESP_HDR&gt;&lt;RESP_BODY&gt;&lt;TOKEN&gt;${tokenValue}&lt;/TOKEN&gt;&lt;/RESP_BODY&gt;&lt;/RESPUESTA&gt;</getTokenReturn></getTokenResponse></soap:Body></soap:Envelope>`;
  const parsed = parseTokenSoapResponse(soap);

  assert.equal(parsed.estado, "00");
  assert.equal(parsed.token, tokenValue);

  const signedXml = "<getToken><Signature /></getToken>";
  const tokenEnvelope = buildGetTokenSoapEnvelope(signedXml);
  assert.match(tokenEnvelope, /&lt;getToken&gt;/);
  const result = await requestToken(signedXml, authConfig(), {
    fetchImpl: async (_url, init) => {
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /pszXml/);
      assert.doesNotMatch(String(init?.body), /<getToken><Signature/);
      return new Response(soap, { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.token, tokenValue);
  assert.ok(result.tokenFingerprint);
  assert.notEqual(result.tokenFingerprint, tokenValue);
  assert.equal(result.redactedToken, "TOKE...RETO");
});

test("SII seed/token reject ESTADO values different from 00", async () => {
  const seedSoap = `<?xml version="1.0"?><Envelope><Body><getSeedReturn>&lt;RESPUESTA&gt;&lt;RESP_HDR&gt;&lt;ESTADO&gt;01&lt;/ESTADO&gt;&lt;GLOSA&gt;BAD&lt;/GLOSA&gt;&lt;/RESP_HDR&gt;&lt;/RESPUESTA&gt;</getSeedReturn></Body></Envelope>`;
  await assert.rejects(
    () => requestSeed(authConfig(), { fetchImpl: async () => new Response(seedSoap, { status: 200 }) }),
    /estado=01/,
  );

  const tokenSoap = `<?xml version="1.0"?><Envelope><Body><getTokenReturn>&lt;RESPUESTA&gt;&lt;RESP_HDR&gt;&lt;ESTADO&gt;11&lt;/ESTADO&gt;&lt;GLOSA&gt;BAD&lt;/GLOSA&gt;&lt;/RESP_HDR&gt;&lt;/RESPUESTA&gt;</getTokenReturn></Body></Envelope>`;
  await assert.rejects(
    () => requestToken("<getToken />", authConfig(), { fetchImpl: async () => new Response(tokenSoap, { status: 200 }) }),
    /estado=11/,
  );
});


function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function extractFirst(value: string, pattern: RegExp): string {
  const match = value.match(pattern);
  assert.ok(match?.[1]);
  return match[1];
}

function publicKeyFingerprintFromCertificate(certificatePem: string): string {
  return createHash("sha256")
    .update(new X509Certificate(certificatePem).publicKey.export({ format: "der", type: "spki" }))
    .digest("hex");
}

function publicKeyFingerprintFromPrivateKey(privateKeyPem: string): string {
  return createHash("sha256")
    .update(createPublicKey(privateKeyPem).export({ format: "der", type: "spki" }))
    .digest("hex");
}

test("SII seed KeyInfo has RSAKeyValue and DER X509Certificate without nesting", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-sii-auth-keyinfo-"));
  const { privateKeyPem, certificatePem } = createSelfSignedFixture(root);
  const result = signSeed("0000012345", authConfig(), { privateKeyPem, certificatePem });
  const signedXml = result.signedXml ?? "";
  const x509Content = extractFirst(signedXml, /<X509Certificate>([^<]+)<\/X509Certificate>/);

  assert.equal(countMatches(signedXml, /<Signature\b/g), 1);
  assert.equal(countMatches(signedXml, /<KeyInfo\b/g), 1);
  assert.equal(countMatches(signedXml, /<KeyValue\b/g), 1);
  assert.equal(countMatches(signedXml, /<RSAKeyValue\b/g), 1);
  assert.equal(countMatches(signedXml, /<Modulus>/g), 1);
  assert.equal(countMatches(signedXml, /<Exponent>/g), 1);
  assert.equal(countMatches(signedXml, /<X509Data\b/g), 1);
  assert.equal(countMatches(signedXml, /<X509Certificate>/g), 1);
  assert.match(signedXml, /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
  assert.match(signedXml, /<KeyInfo>\s*<KeyValue>/);
  assert.doesNotMatch(signedXml, /<KeyInfo>\s*<KeyInfo/);
  assert.doesNotMatch(signedXml, /<ds:/);
  assert.doesNotMatch(x509Content, /BEGIN CERTIFICATE|END CERTIFICATE|\s/);
  assert.ok(Buffer.from(x509Content, "base64").length > 0);
  assert.equal(new X509Certificate(Buffer.from(x509Content, "base64")).raw.toString("base64"), x509Content);
  assert.equal(x509Content, new X509Certificate(certificatePem).raw.toString("base64"));
  assert.equal(publicKeyFingerprintFromCertificate(certificatePem), publicKeyFingerprintFromPrivateKey(privateKeyPem));
  assert.equal(verifySignedSeedXml(signedXml, certificatePem), true);
});

test("SII KeyInfo builder rejects invalid or non-DER certificate material", () => {
  assert.throws(() => buildSiiSeedKeyInfoContent("not-a-certificate"));
});

test("SII auth config falls back to issuer and representative RUT env vars", () => {
  const config = getSiiCertificationConfigFromEnv({
    DTE_SII_ENV: "certification",
    DTE_ISSUER_RUT: "78195645-7",
    DTE_CERT_REPRESENTATIVE_RUT: "27164542-2",
  });

  assert.equal(config.rutEmpresa, "78195645-7");
  assert.equal(config.rutUsuario, "27164542-2");
});

test("SII auth smoke is blocked without explicit live confirmation", () => {
  const result = spawnSync("npm", ["run", "dte:sii:auth:smoke"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DTE_SII_ENV: "certification",
      DTE_SII_LIVE_AUTH: "",
      DTE_SII_TOKEN: "full-token-must-not-print",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-must-not-print",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /environment=certification/);
  assert.match(result.stdout, /token=blocked/);
  assert.match(result.stderr, /DTE_SII_LIVE_AUTH=true requerido/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /full-token-must-not-print|service-role-secret-must-not-print/);
});

test("blocks production DTE mode until real approval", () => {
  assert.throws(
    () => getSiiCertificationConfigFromEnv({ DTE_MODE: "production" }),
    (error) =>
      error instanceof SiiCertificationError &&
      error.code === SII_ERROR_CODES.PRODUCTION_DISABLED,
  );
});

test("blocks production SII environment until real approval", () => {
  assert.throws(
    () => getSiiCertificationConfigFromEnv({ DTE_SII_ENV: "production" }),
    (error) =>
      error instanceof SiiCertificationError &&
      error.code === SII_ERROR_CODES.PRODUCTION_DISABLED,
  );
});

test("validates SII certification config without exposing secrets", () => {
  const items = validateDteConfig({
    mode: "certification",
    repoRoot: process.cwd(),
    env: {
      DTE_MODE: "certification",
      DTE_SII_ENV: "certification",
      DTE_CAF_PATH: "/tmp/caf.xml",
      DTE_CAF_PRIVATE_KEY_PATH: "/tmp/caf-key.pem",
      DTE_CERT_PATH: "/tmp/cert.pem",
      DTE_PRIVATE_KEY_PATH: "/tmp/key.pem",
    },
  });

  assert.equal(
    items.some((item) => item.key === "DTE_SII_SEED_URL" && item.status === "MISSING"),
    true,
  );
  assert.equal(
    items.some((item) => item.message.includes("PRIVATE KEY")),
    false,
  );
});

test("signs seed with fixture certificate using SII XMLDSig", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-sii-auth-legacy-"));
  const { privateKeyPem, certificatePem } = createSelfSignedFixture(root);
  const result = signSeed("123456789", authConfig(), { privateKeyPem, certificatePem });

  assert.equal(result.ok, true);
  assert.match(result.signedSeed ?? "", /<Signature/);
  assert.equal(verifySignedSeedXml(result.signedSeed ?? "", certificatePem), true);
});

test("parses SII submission/status fixtures conservatively", () => {
  assert.equal(parseSiiSubmissionResponse({ TRACKID: "123", ESTADO: "REC" }).status, "sent");
  assert.equal(parseSiiStatusResponse({ trackId: "123", estado: "PDR" }).status, "processing");
  assert.equal(parseSiiStatusResponse({ track_id: "123", status: "EPR" }).status, "accepted");
  assert.equal(parseSiiStatusResponse({ track_id: "123", status: "EOK" }).status, "accepted_with_observations");
  assert.equal(parseSiiStatusResponse({ track_id: "123", status: "RCH" }).status, "rejected");
  assert.equal(parseSiiStatusResponse({ status: "ERR" }).status, "failed");
  assert.equal(parseSiiStatusResponse({ status: "NO_SE" }).status, "unknown");
  assert.equal(mapRawSiiStatus("ACEPTADO"), "accepted");
  assert.equal(mapSiiStatusToInternalStatus("processing"), "submitted");
  assert.equal(mapSiiStatusToInternalStatus("failed"), "failed");
});

test("smoke dry-run exits without secrets or network", () => {
  const result = spawnSync(
    "node",
    ["scripts/dte/sii-certification-smoke.mjs", "--dry-run"],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /LAB \/ PENDIENTE \/ NO PRODUCTIVO/);
  assert.match(result.stdout, /Submit real bloqueado en dry-run/);
  assert.doesNotMatch(result.stdout, /MOCK-/);
  assert.match(result.stdout, /No se genera track_id simulado/);
});


test("controlled certification submit blocks by default without SII contact", () => {
  const result = spawnSync("npm", ["run", "dte:certification:submit"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DTE_MODE: "certification",
      DTE_SII_ENV: "certification",
      DTE_SII_ENABLE_SUBMIT: "",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-must-not-print",
      DTE_SII_TOKEN: "full-token-must-not-print",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /globalStatus=LAB \/ PENDIENTE \/ NO PRODUCTIVO/);
  assert.match(result.stdout, /\[blocked_submit\] submit_flag/);
  assert.match(result.stdout, /track_id_simulado=NO/);
  assert.doesNotMatch(result.stdout, /service-role-secret-must-not-print|full-token-must-not-print/);
  assert.doesNotMatch(result.stderr, /service-role-secret-must-not-print|full-token-must-not-print/);
});

test("controlled certification submit blocks production modes", () => {
  const productionMode = spawnSync("npm", ["run", "dte:certification:submit"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DTE_MODE: "production", DTE_SII_ENV: "certification" },
  });
  assert.equal(productionMode.status, 2);
  assert.match(productionMode.stdout, /blocked_production/);

  const productionSii = spawnSync("npm", ["run", "dte:certification:submit"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DTE_MODE: "certification", DTE_SII_ENV: "production" },
  });
  assert.equal(productionSii.status, 2);
  assert.match(productionSii.stdout, /DTE_SII_ENV=production bloqueado/);
});

test("controlled certification submit requires Supabase backend and SII endpoints", () => {
  const result = spawnSync("npm", ["run", "dte:certification:submit"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DTE_MODE: "certification",
      DTE_SII_ENV: "certification",
      DTE_SII_ENABLE_SUBMIT: "true",
      DTE_PERSISTENCE_BACKEND: "memory",
      DTE_SMOKE_TENANT_ID: "84ce60a0-1eb0-426b-adbc-c9cfbc76807c",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Submit real requiere DTE_PERSISTENCE_BACKEND=supabase/);
  assert.match(result.stdout, /Falta DTE_SII_SEED_URL/);
  assert.match(result.stdout, /Falta DTE_SII_SUBMIT_URL/);
});

test("controlled certification submit blocks external files inside repo", () => {
  const result = spawnSync("npm", ["run", "dte:certification:submit"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DTE_MODE: "certification",
      DTE_SII_ENV: "certification",
      DTE_SII_ENABLE_SUBMIT: "true",
      DTE_PERSISTENCE_BACKEND: "supabase",
      DTE_SMOKE_TENANT_ID: "84ce60a0-1eb0-426b-adbc-c9cfbc76807c",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret-service-role",
      DTE_SII_SEED_URL: "https://sii.example/seed",
      DTE_SII_TOKEN_URL: "https://sii.example/token",
      DTE_SII_SUBMIT_URL: "https://sii.example/submit",
      DTE_SII_STATUS_URL: "https://sii.example/status",
      DTE_CAF_PATH: "docs/dte-sii/samples/lab-envio-dte.xml",
      DTE_CERT_PATH: "docs/dte-sii/samples/lab-envio-dte.xml",
      DTE_PRIVATE_KEY_PATH: "docs/dte-sii/samples/lab-envio-dte.xml",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /apunta dentro del repo/);
  assert.doesNotMatch(result.stdout, /secret-service-role/);
});

test("certification XML command blocks safely without external CAF/cert/key", () => {
  const result = spawnSync("npm", ["run", "dte:certification:xml"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DTE_CAF_PATH: "",
      DTE_CAF_PRIVATE_KEY_PATH: "",
      DTE_CERT_PATH: "",
      DTE_PRIVATE_KEY_PATH: "",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-must-not-print",
    },
  });

  assert.equal(result.status, 3);
  assert.match(result.stderr, /pending_real_certification/);
  assert.match(result.stderr, /missing_external_files=/);
  assert.match(result.stderr, /no se contacta SII/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /service-role-secret-must-not-print/);
});

test("certification XML command blocks production modes", () => {
  const result = spawnSync(
    "node",
    ["scripts/dte/generate-lab-xml.mjs", "--mode=certification"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DTE_MODE: "production", DTE_SII_ENV: "certification" },
    },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /blocked_production/);
});

test("certification validate-xml fails clearly when XML is missing", () => {
  const result = spawnSync("npm", ["run", "dte:certification:validate-xml", "--", "/tmp/citaya-missing-certification.xml"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /XML file not found/);
  assert.match(result.stderr, /xsd_valid=false/);
});

test("controlled certification submit suggests XML generation when artifact is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-dte-submit-missing-xml-"));
  const cafPath = join(root, "caf.xml");
  const cafKeyPath = join(root, "caf-key.pem");
  const certPath = join(root, "cert.pem");
  const keyPath = join(root, "private-key.pem");
  const missingXmlPath = join(root, "missing-certification-envio-dte.xml");
  writeFileSync(cafPath, "<CAF></CAF>", "utf8");
  writeFileSync(cafKeyPath, "not-used-before-xml-check", "utf8");
  writeFileSync(certPath, "not-used-before-xml-check", "utf8");
  writeFileSync(keyPath, "not-used-before-xml-check", "utf8");

  const result = spawnSync("npm", ["run", "dte:certification:submit"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DTE_MODE: "certification",
      DTE_SII_ENV: "certification",
      DTE_SII_ENABLE_SUBMIT: "true",
      DTE_PERSISTENCE_BACKEND: "supabase",
      DTE_SMOKE_TENANT_ID: "84ce60a0-1eb0-426b-adbc-c9cfbc76807c",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret-service-role",
      DTE_SII_SEED_URL: "https://sii.example/seed",
      DTE_SII_TOKEN_URL: "https://sii.example/token",
      DTE_SII_SUBMIT_URL: "https://sii.example/submit",
      DTE_SII_STATUS_URL: "https://sii.example/status",
      DTE_CAF_PATH: cafPath,
      DTE_CAF_PRIVATE_KEY_PATH: cafKeyPath,
      DTE_CERT_PATH: certPath,
      DTE_PRIVATE_KEY_PATH: keyPath,
      DTE_CERTIFICATION_OUTPUT_PATH: missingXmlPath,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /npm run dte:certification:xml/);
  assert.match(result.stdout, /pending_real_certification/);
  assert.doesNotMatch(result.stdout, /secret-service-role/);
});

test("SII submission parsing and persistence keep missing track_id as null", () => {
  const parsed = parseSiiSubmissionResponse({ ESTADO: "REC", GLOSA: "recibido" });
  assert.equal(parsed.trackId, null);

  const submission = buildSubmissionRecord({
    tenantId: "tenant-1",
    taxDocumentId: "doc-1",
    environment: "certification",
    trackId: parsed.trackId,
    submissionStatus: "submitted",
    siiStatus: "sent",
    token: "complete-token-value",
    response: { status: "REC", token: "complete-token-value" },
  });

  assert.equal(submission.trackId, null);
  assert.notEqual(submission.tokenFingerprint, "complete-token-value");
  assert.doesNotMatch(JSON.stringify(submission.rawResponseRedacted), /complete-token-value/);
});
