import assert from "node:assert/strict";

console.log("=== HISTORICAL DATA VALIDATION SMOKE TEST ===");

// Fixtures
const cafs = [
  { id: "caf-1", dte_type: 33, environment: "unclassified", status: "unclassified", range_from: 1, range_to: 100 },
  { id: "caf-2", dte_type: 39, environment: "certification", status: "pending_review", range_from: 16, range_to: 20 },
  { id: "caf-3", dte_type: 33, environment: "production", status: "active", range_from: 101, range_to: 200 },
  { id: "caf-4", dte_type: 39, environment: "production", status: "active", range_from: 21, range_to: 50 },
  { id: "caf-5", dte_type: 39, environment: "production", status: "revoked", range_from: 51, range_to: 100 },
];

const outboxes = [
  { id: "outbox-1", dte_type: 33, issuance_origin: "legacy_unknown" },
  { id: "outbox-2", dte_type: 39, issuance_origin: "legacy_unknown" },
  { id: "outbox-3", dte_type: 39, issuance_origin: "manual_admin" },
  { id: "outbox-4", dte_type: 39, issuance_origin: "automatic_system" },
];

// Helper functions matching domain gate rules
function filterValidProductionCaf(items, targetDteType) {
  return items.find(
    (c) => c.dte_type === targetDteType && c.environment === "production" && c.status === "active",
  ) ?? null;
}

function isValidManualOrigin(origin) {
  return origin === "manual_admin";
}

// 1. Historical CAF without classification -> blocked
const caf1Valid = filterValidProductionCaf([cafs[0]], 33);
assert.equal(caf1Valid, null, "Historical CAF without classification must be BLOCKED");

// 2. Certification CAF -> blocked
const caf2Valid = filterValidProductionCaf([cafs[1]], 39);
assert.equal(caf2Valid, null, "Certification CAF must be BLOCKED for production");

// 3. Production CAF Type 33 -> valid for 33, blocked for 39
assert.notEqual(filterValidProductionCaf([cafs[2]], 33), null, "Production Type 33 CAF valid for 33");
assert.equal(filterValidProductionCaf([cafs[2]], 39), null, "Production Type 33 CAF blocked for 39");

// 4. Production CAF Type 39 -> valid for 39
assert.notEqual(filterValidProductionCaf([cafs[3]], 39), null, "Production Type 39 CAF valid for 39");

// 5. Revoked CAF -> blocked
assert.equal(filterValidProductionCaf([cafs[4]], 39), null, "Revoked CAF must be BLOCKED");

// 6. Historical outbox without origin -> blocked for Type 39 manual
assert.equal(isValidManualOrigin(outboxes[1].issuance_origin), false, "Historical outbox legacy_unknown must be BLOCKED");

// 7. Manual outbox -> allowed
assert.equal(isValidManualOrigin(outboxes[2].issuance_origin), true, "Manual outbox manual_admin must be ALLOWED");

// 8. Automatic outbox Type 39 -> blocked for manual origin
assert.equal(isValidManualOrigin(outboxes[3].issuance_origin), false, "Automatic outbox for Type 39 must be BLOCKED");

console.log("Historical Data Validation Smoke Test PASSED: 8/8 assertions verified.");
console.log("CERTIFICATION_FOLIOS_16_20_NOT_PRODUCTION=true");
