import assert from "node:assert/strict";
import test from "node:test";

import {
  runOneAutomaticIssuanceWorker,
  runOneManualIssuanceWorker,
  type ClaimedOutbox,
  type DteWorkerDependencies,
  type DteWorkerResult,
} from "../automation/worker";

const processed: DteWorkerResult = {
  processed: true,
  status: "SUBMITTED",
  siiContacted: true,
  networkAttempts: 1,
};

const manualItem: ClaimedOutbox = {
  id: "10000000-0000-4000-8000-000000000001",
  tenant_id: "10000000-0000-4000-8000-000000000002",
  intent_id: "10000000-0000-4000-8000-000000000003",
  deterministic_attempts: 0,
  issuance_origin: "manual_admin",
};

const automaticItem: ClaimedOutbox = {
  ...manualItem,
  id: "20000000-0000-4000-8000-000000000001",
  intent_id: "20000000-0000-4000-8000-000000000003",
  issuance_origin: "automatic_system",
  locked_by: "citaya-automatic:test",
  claim_token: "20000000-0000-4000-8000-000000000004",
};

function preserveWorkerEnv() {
  const production = process.env.DTE_PRODUCTION_ENABLED;
  const automatic = process.env.DTE_AUTOMATIC_WORKER_ENABLED;
  return () => {
    if (production === undefined) delete process.env.DTE_PRODUCTION_ENABLED;
    else process.env.DTE_PRODUCTION_ENABLED = production;
    if (automatic === undefined) delete process.env.DTE_AUTOMATIC_WORKER_ENABLED;
    else process.env.DTE_AUTOMATIC_WORKER_ENABLED = automatic;
  };
}

test("automatic worker is fail-closed and does not claim when its flag is absent", async () => {
  const restore = preserveWorkerEnv();
  let claims = 0;
  try {
    process.env.DTE_PRODUCTION_ENABLED = "true";
    delete process.env.DTE_AUTOMATIC_WORKER_ENABLED;
    const dependencies: DteWorkerDependencies = {
      claimManual: async () => null,
      claimAutomatic: async () => { claims += 1; return automaticItem; },
      processClaimed: async () => processed,
    };
    const result = await runOneAutomaticIssuanceWorker(dependencies);
    assert.equal(result.status, "DISABLED");
    assert.equal(claims, 0);
  } finally {
    restore();
  }
});

test("manual and explicitly enabled automatic dispatch use the same claimed-item engine", async () => {
  const restore = preserveWorkerEnv();
  const processedOrigins: string[] = [];
  try {
    process.env.DTE_PRODUCTION_ENABLED = "true";
    process.env.DTE_AUTOMATIC_WORKER_ENABLED = "true";
    const dependencies: DteWorkerDependencies = {
      claimManual: async () => manualItem,
      claimAutomatic: async () => automaticItem,
      processClaimed: async (item) => {
        processedOrigins.push(String(item.issuance_origin));
        return processed;
      },
    };
    assert.deepEqual(await runOneManualIssuanceWorker({}, dependencies), processed);
    assert.deepEqual(await runOneAutomaticIssuanceWorker(dependencies), processed);
    assert.deepEqual(processedOrigins, ["manual_admin", "automatic_system"]);
  } finally {
    restore();
  }
});
