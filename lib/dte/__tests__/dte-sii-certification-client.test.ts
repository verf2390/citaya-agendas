import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validateDteConfig } from "../config/validate-dte-config";
import { buildSubmissionRecord } from "../persistence/dte-submissions";
import {
  getSiiCertificationConfigFromEnv,
  signSeed,
} from "../sii/sii-certification-client";
import { SII_ERROR_CODES, SiiCertificationError } from "../sii/sii-errors";
import {
  mapRawSiiStatus,
  mapSiiStatusToInternalStatus,
  parseSiiStatusResponse,
  parseSiiSubmissionResponse,
} from "../sii/sii-status";

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

test("signs seed with fixture private key using Node crypto", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const result = signSeed(
    "123456789",
    {
      environment: "certification",
      seedUrl: "https://sii.example/seed",
      tokenUrl: "https://sii.example/token",
      submitUrl: "https://sii.example/submit",
      statusUrl: "https://sii.example/status",
      timeoutMs: 30_000,
      enableSubmit: false,
    },
    { privateKeyPem },
  );

  assert.equal(result.ok, true);
  assert.match(result.signedSeed ?? "", /^[A-Za-z0-9+/=]+$/);
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
