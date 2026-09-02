import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidProductionIssuerActivityCode,
  hasValidProductionIssuerActivityCode,
  assertValidProductionIssuerResolution,
  hasValidProductionIssuerResolution,
} from "../production/issuer-settings";

test("production issuer requires a real, past SII resolution", () => {
  assert.equal(
    hasValidProductionIssuerResolution(
      {
        resolutionDate: "2026-07-28",
        resolutionNumber: "80",
        siiOffice: "LA SERENA",
      },
      "2026-07-28",
    ),
    true,
  );
  assert.equal(
    hasValidProductionIssuerResolution(
      {
        resolutionDate: "2014-08-22",
        resolutionNumber: "80",
        siiOffice: null,
      },
      "2026-07-28",
    ),
    true,
  );
  for (const issuer of [
    { resolutionDate: "", resolutionNumber: "", siiOffice: "" },
    {
      resolutionDate: "2026-02-30",
      resolutionNumber: "80",
      siiOffice: "LA SERENA",
    },
    {
      resolutionDate: "2026-07-29",
      resolutionNumber: "80",
      siiOffice: "LA SERENA",
    },
    {
      resolutionDate: "2026-07-28",
      resolutionNumber: "0",
      siiOffice: "LA SERENA",
    },
  ]) {
    assert.equal(
      hasValidProductionIssuerResolution(issuer, "2026-07-28"),
      false,
    );
  }
});

test("production issuer resolution fails closed before generation", () => {
  assert.throws(
    () =>
      assertValidProductionIssuerResolution({
        resolutionDate: "",
        resolutionNumber: "",
        siiOffice: "",
      }),
    /DTE_PRODUCTION_SII_RESOLUTION_INVALID/,
  );
});

test("production issuer Acteco is mandatory and must satisfy the official XSD scalar", () => {
  assert.equal(hasValidProductionIssuerActivityCode({
    businessActivityCode: "620900",
  }), true);
  for (const businessActivityCode of [null, "", "ABC", "000000", "1234567"]) {
    assert.equal(hasValidProductionIssuerActivityCode({ businessActivityCode }), false);
  }
  assert.throws(
    () => assertValidProductionIssuerActivityCode({ businessActivityCode: null }),
    /DTE_PRODUCTION_ISSUER_ACTIVITY_CODE_REQUIRED/,
  );
});
