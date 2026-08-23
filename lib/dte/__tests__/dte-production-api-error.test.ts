import assert from "node:assert/strict";
import test from "node:test";

import {
  safeProductionApiError,
  safeProductionApiErrorCode,
} from "../production/api";

const preservedCodes = [
  "BOLETA_REST_STATUS_TIMEOUT",
  "BOLETA_REST_DOCUMENT_STATUS_HTTP_INVALID",
  "BOLETA_API_ISSUE_DATE_INVALID",
  "DTE_RECIPIENT_RUT_INVALID",
];

for (const code of preservedCodes) {
  test(`production API preserves the safe error code ${code}`, () => {
    assert.equal(safeProductionApiErrorCode(new Error(code)), code);
  });
}

test("production API maps unknown errors to the generic code", () => {
  assert.equal(
    safeProductionApiErrorCode(new Error("unexpected upstream failure")),
    "DTE_PRODUCTION_REQUEST_FAILED",
  );
});

test("production API returns only the first allowlisted token", async () => {
  const error = new Error(
    "BOLETA_REST_STATUS_NETWORK_ERROR TOKEN=secreto " +
      "Cookie=session body=<html> https://sii.invalid/private",
  );
  error.stack =
    "Error: sensitive stack\n-----BEGIN PRIVATE KEY-----\nPEM_SECRET";

  assert.equal(
    safeProductionApiErrorCode(error),
    "BOLETA_REST_STATUS_NETWORK_ERROR",
  );

  const response = safeProductionApiError(error);
  const payload = await response.json();
  assert.deepEqual(payload, {
    ok: false,
    error: "BOLETA_REST_STATUS_NETWORK_ERROR",
  });

  const serialized = JSON.stringify(payload);
  for (const secret of [
    "TOKEN",
    "secreto",
    "Cookie",
    "PEM",
    "PRIVATE KEY",
    "body",
    "<html>",
    "https://",
    "stack",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret, "i"));
  }
});
