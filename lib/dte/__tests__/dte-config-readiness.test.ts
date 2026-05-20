import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildDteCertificationReadiness, validateDteConfig } from "../config/validate-dte-config";
import { checkDteReadiness } from "../readiness/check-dte-readiness";

test("requires certification secrets only in certification mode", () => {
  const labItems = validateDteConfig({
    mode: "lab",
    env: {},
    repoRoot: process.cwd(),
  });
  assert.equal(
    labItems.some((item) => item.key === "DTE_CAF_PATH" && item.status === "MISSING"),
    false,
  );

  const certificationItems = validateDteConfig({
    mode: "certification",
    env: { DTE_MODE: "certification" },
    repoRoot: process.cwd(),
  });
  assert.equal(
    certificationItems.some(
      (item) => item.key === "DTE_CAF_PATH" && item.status === "MISSING",
    ),
    true,
  );
});

test("flags secret paths inside repo as dangerous", () => {
  const items = validateDteConfig({
    mode: "certification",
    env: {
      DTE_MODE: "certification",
      DTE_CAF_PATH: "./docs/caf.xml",
      DTE_CAF_PRIVATE_KEY_PATH: "/tmp/caf-key.pem",
      DTE_CERT_PATH: "/tmp/cert.pem",
      DTE_PRIVATE_KEY_PATH: "/tmp/private-key.pem",
    },
    repoRoot: process.cwd(),
  });

  assert.equal(
    items.some((item) => item.key === "DTE_CAF_PATH" && item.status === "DANGEROUS"),
    true,
  );
});

test("readiness never claims production approval", () => {
  const readiness = checkDteReadiness({
    repoRoot: process.cwd(),
    env: { DTE_MODE: "lab" },
  });

  assert.equal(readiness.globalStatus, "LAB / PENDIENTE / NO PRODUCTIVO");
  assert.equal(readiness.items.some((item) => /aprobado SII/i.test(item.message)), false);
});


test("certification readiness reports pending config without real variables", () => {
  const readiness = buildDteCertificationReadiness({
    mode: "certification",
    env: { DTE_MODE: "certification", DTE_SII_ENV: "certification" },
    repoRoot: process.cwd(),
  });

  assert.equal(readiness.status, "pending_config");
  assert.equal(readiness.globalStatus, "LAB / PENDIENTE / NO PRODUCTIVO");
  assert.equal(
    readiness.items.some((item) => item.key === "DTE_SII_SUBMIT_URL" && item.status === "MISSING"),
    true,
  );
});

test("certification readiness blocks production mode and SII env", () => {
  assert.equal(
    buildDteCertificationReadiness({
      mode: "production",
      env: { DTE_MODE: "production", DTE_SII_ENV: "certification" },
      repoRoot: process.cwd(),
    }).status,
    "blocked_production",
  );

  assert.equal(
    buildDteCertificationReadiness({
      mode: "certification",
      env: { DTE_MODE: "certification", DTE_SII_ENV: "production" },
      repoRoot: process.cwd(),
    }).status,
    "blocked_production",
  );
});

test("certification readiness requires external files to exist", () => {
  const readiness = buildDteCertificationReadiness({
    mode: "certification",
    env: {
      DTE_MODE: "certification",
      DTE_SII_ENV: "certification",
      DTE_SII_SEED_URL: "https://sii.example/seed",
      DTE_SII_TOKEN_URL: "https://sii.example/token",
      DTE_SII_SUBMIT_URL: "https://sii.example/submit",
      DTE_SII_STATUS_URL: "https://sii.example/status",
      DTE_CAF_PATH: "/tmp/citaya-missing-caf.xml",
      DTE_CAF_PRIVATE_KEY_PATH: "/tmp/citaya-missing-caf-key.pem",
      DTE_CERT_PATH: "/tmp/citaya-missing-cert.pem",
      DTE_PRIVATE_KEY_PATH: "/tmp/citaya-missing-private-key.pem",
    },
    repoRoot: process.cwd(),
  });

  assert.equal(readiness.status, "missing_external_file");
  assert.equal(
    readiness.items.some((item) => item.key === "DTE_CERT_PATH" && item.status === "MISSING"),
    true,
  );
});

test("certification readiness can become ready with external files", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-dte-cert-"));
  const cafPath = join(root, "caf.xml");
  const cafKeyPath = join(root, "caf-key.pem");
  const certPath = join(root, "cert.pem");
  const keyPath = join(root, "private-key.pem");
  for (const file of [cafPath, cafKeyPath, certPath, keyPath]) {
    writeFileSync(file, "placeholder external fixture", "utf8");
  }

  const readiness = buildDteCertificationReadiness({
    mode: "certification",
    env: {
      DTE_MODE: "certification",
      DTE_SII_ENV: "certification",
      DTE_SII_SEED_URL: "https://sii.example/seed",
      DTE_SII_TOKEN_URL: "https://sii.example/token",
      DTE_SII_SUBMIT_URL: "https://sii.example/submit",
      DTE_SII_STATUS_URL: "https://sii.example/status",
      DTE_CAF_PATH: cafPath,
      DTE_CAF_PRIVATE_KEY_PATH: cafKeyPath,
      DTE_CERT_PATH: certPath,
      DTE_PRIVATE_KEY_PATH: keyPath,
    },
    repoRoot: process.cwd(),
  });

  assert.equal(readiness.status, "ready");
});

test("certification readiness command does not print secret values", () => {
  const result = spawnSync("npm", ["run", "dte:certification:readiness"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DTE_MODE: "lab",
      DTE_SII_ENV: "certification",
      DTE_PRIVATE_KEY_PASSWORD: "super-secret-password",
      DTE_CERT_PASSWORD: "another-secret-password",
    },
  });

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /super-secret-password|another-secret-password/);
  assert.match(result.stdout, /track_id=pendiente_real_no_simulado/);
});
