import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validateDteConfig } from "../config/validate-dte-config";
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
