import assert from "node:assert/strict";
import test from "node:test";

import {
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
