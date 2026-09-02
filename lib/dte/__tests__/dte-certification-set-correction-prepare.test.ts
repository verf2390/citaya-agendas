import assert from "node:assert/strict";
import test from "node:test";

import {
  CorrectionPrepareError,
  formatCorrectionPrepare,
  formatCorrectionPrepareError,
  prepareFacturaCertificationSetCorrection,
} from "../certification/factura-certification-set-correction-prepare";

test("correction preparation fails closed before reading certification material", () => {
  const base = {
    DTE_MODE: "certification",
    DTE_SII_ENV: "certification",
    NODE_ENV: "test",
    DTE_FACTURA_CERTIFICATION_CORRECTION_CONFIRM: "invalid",
  };

  for (const [patch, field] of [
    [{ DTE_MODE: "lab" }, "environment"],
    [{ DTE_SII_LIVE_AUTH: "true" }, "external_operations"],
    [{ DTE_FACTURA_CERTIFICATION_CORRECTION_CONFIRM: "invalid" }, "confirmation"],
  ] as const) {
    assert.throws(
      () => prepareFacturaCertificationSetCorrection({ ...base, ...patch }),
      (error: unknown) =>
        error instanceof CorrectionPrepareError && error.field === field,
    );
  }
});

test("correction preparation formats safe offline results and errors", () => {
  assert.equal(
    formatCorrectionPrepare({
      status: "CORRECTION_PREPARED_OFFLINE",
      documents: 8,
      type33: 4,
      type61: 3,
      type56: 1,
      folios: "33:1-4,61:1-3,56:1",
      ledgerUnchanged: true,
      envelopeSha256: "a".repeat(64),
      siiContacted: false,
      readyForSubmitPreflight: true,
    }),
    [
      "status=CORRECTION_PREPARED_OFFLINE",
      "documents=8",
      "type33=4",
      "type61=3",
      "type56=1",
      "folios=33:1-4,61:1-3,56:1",
      "ledgerUnchanged=true",
      `envelopeSha256=${"a".repeat(64)}`,
      "siiContacted=false",
      "readyForSubmitPreflight=true",
    ].join("\n"),
  );
  assert.equal(
    formatCorrectionPrepareError(new CorrectionPrepareError("confirmation")),
    "code=CERTIFICATION_SET_CORRECTION_REJECTED\nfield=confirmation\nmessage=controlled_operation_failed",
  );
});
