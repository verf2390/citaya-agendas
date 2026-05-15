import assert from "node:assert/strict";
import test from "node:test";

import { validateDteConfig } from "../config/validate-dte-config";
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
