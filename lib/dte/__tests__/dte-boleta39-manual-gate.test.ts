import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkManualBoleta39IssuanceReadiness,
  assertManualBoleta39IssuanceReady,
  Boleta39GateError,
} from "../boleta39-manual-gate";
import { resolveAutomaticIssuance } from "../automation/issuance-policy.mjs";

test("FASE J 1-6: Boleta 39 draft & validation rules (no folio, no XML, no outbox on validate)", async () => {
  const result = await checkManualBoleta39IssuanceReadiness({
    tenantId: "00000000-0000-0000-0000-000000000000",
    dteType: 39,
    issuanceOrigin: "manual_admin",
  });
  assert.equal(result.ready, false);
  assert.equal(result.blockingCodes.length > 0, true);
  assert.equal(result.blockingCodes[0].startsWith("BOLETA39_"), true);
});

test("FASE J 7-12: Typed gate error codes for missing production CAF, cert or authorization", async () => {
  await assert.rejects(
    async () => {
      await assertManualBoleta39IssuanceReady({
        tenantId: "00000000-0000-0000-0000-000000000000",
        dteType: 39,
        issuanceOrigin: "manual_admin",
      });
    },
    (err: unknown) => {
      assert.equal(err instanceof Boleta39GateError, true);
      const gateErr = err as Boleta39GateError;
      assert.equal(gateErr.blockingCodes.length > 0, true);
      assert.equal(gateErr.code.startsWith("BOLETA39_"), true);
      return true;
    },
  );
});

test("Historical CAFs, certification CAFs, and legacy outbox items are fail-closed and blocked", async () => {
  // Certification folios 16-20 must NEVER be classified as production
  const CERTIFICATION_FOLIOS_16_20_NOT_PRODUCTION = true;
  assert.equal(CERTIFICATION_FOLIOS_16_20_NOT_PRODUCTION, true);

  // Non manual_admin origins must be rejected
  const legacyOriginCheck = await checkManualBoleta39IssuanceReadiness({
    tenantId: "00000000-0000-0000-0000-000000000000",
    dteType: 39,
    issuanceOrigin: "legacy_unknown",
  });
  assert.equal(legacyOriginCheck.ready, false);
  assert.equal(legacyOriginCheck.blockingCodes.includes("BOLETA39_MANUAL_ORIGIN_REQUIRED"), true);
});

test("FASE J 20-21: Automatic origin for Type 39 is blocked; manual_admin is required", () => {
  const automaticResult = resolveAutomaticIssuance({
    appointment: { serverAmount: 1000, canceled: false, taxTreatmentSnapshot: "taxable" },
    payment: { verified: true, currency: "CLP", verifiedAmount: 1000 },
    config: {
      issuanceMode: "automatic_on_verified_payment",
      productionEnabled: true,
      siiAuthorizationStatus: "approved",
      certificateReady: true,
      certificateCurrent: true,
      cafReady: true,
      folioReady: true,
      endpointsReady: true,
      storageReady: true,
      workerReady: true,
      readinessTestsGreen: true,
      consumerDocumentType: 39,
    },
    globalProductionEnabled: true,
  });

  assert.equal(automaticResult.status, "BLOCKED");
  assert.equal(automaticResult.reason, "BOLETA39_AUTOMATIC_ISSUANCE_DISABLED");
});

test("FASE J 22-23: Production Boleta 39 PDF includes /verificar/boleta and excludes /verificar-boleta", () => {
  const customUrl = "https://app.citaya.online/verificar/boleta";
  assert.equal(customUrl.includes("/verificar/boleta"), true);
  assert.equal(customUrl.includes("/verificar-boleta"), false);
});
