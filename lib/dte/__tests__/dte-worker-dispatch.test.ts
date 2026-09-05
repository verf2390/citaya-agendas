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
    const result = await runOneAutomaticIssuanceWorker({}, dependencies);
    assert.equal(result.status, "DISABLED");
    assert.equal(claims, 0);
  } finally {
    restore();
  }
});

test("manual and explicitly enabled automatic dispatch use the same claimed-item engine", async () => {
  const restore = preserveWorkerEnv();
  const processedOrigins: string[] = [];
  const claimedTargets: Array<string | undefined> = [];
  try {
    process.env.DTE_PRODUCTION_ENABLED = "true";
    process.env.DTE_AUTOMATIC_WORKER_ENABLED = "true";
    const dependencies: DteWorkerDependencies = {
      claimManual: async () => manualItem,
      claimAutomatic: async (options) => {
        claimedTargets.push(options.automaticTargetOutboxId);
        return automaticItem;
      },
      processClaimed: async (item) => {
        processedOrigins.push(String(item.issuance_origin));
        return processed;
      },
    };
    assert.deepEqual(await runOneManualIssuanceWorker({}, dependencies), processed);
    assert.deepEqual(await runOneAutomaticIssuanceWorker({
      automaticTargetOutboxId: automaticItem.id,
    }, dependencies), processed);
    assert.deepEqual(processedOrigins, ["manual_admin", "automatic_system"]);
    assert.deepEqual(claimedTargets, [automaticItem.id]);
  } finally {
    restore();
  }
});

test("automatic target presence is fail-closed and never degrades to a global claim", async () => {
  const restore = preserveWorkerEnv();
  let claims = 0;
  try {
    process.env.DTE_PRODUCTION_ENABLED = "true";
    process.env.DTE_AUTOMATIC_WORKER_ENABLED = "true";
    const dependencies: DteWorkerDependencies = {
      claimManual: async () => null,
      claimAutomatic: async () => { claims += 1; return null; },
      processClaimed: async () => processed,
    };
    await assert.rejects(
      runOneAutomaticIssuanceWorker({ automaticTargetOutboxId: "" }, dependencies),
      /DTE_AUTOMATIC_TARGET_OUTBOX_INVALID/,
    );
    await assert.rejects(
      runOneAutomaticIssuanceWorker(
        { automaticTargetOutboxId: 42 } as unknown as { automaticTargetOutboxId: string },
        dependencies,
      ),
      /DTE_AUTOMATIC_TARGET_OUTBOX_INVALID/,
    );
    assert.equal(claims, 0);
  } finally {
    restore();
  }
});

test("owned-folio recovery requires and preserves one exact automatic target", async () => {
  const restore = preserveWorkerEnv();
  const claimedOptions: Array<{
    automaticTargetOutboxId?: string;
    automaticOwnedFolioResume?: boolean;
  }> = [];
  try {
    process.env.DTE_PRODUCTION_ENABLED = "true";
    process.env.DTE_AUTOMATIC_WORKER_ENABLED = "true";
    const dependencies: DteWorkerDependencies = {
      claimManual: async () => null,
      claimAutomatic: async (options) => {
        claimedOptions.push(options);
        return automaticItem;
      },
      processClaimed: async () => processed,
    };
    await assert.rejects(
      runOneAutomaticIssuanceWorker(
        { automaticOwnedFolioResume: true },
        dependencies,
      ),
      /DTE_AUTOMATIC_OWNED_FOLIO_RESUME_TARGET_REQUIRED/,
    );
    await assert.rejects(
      runOneAutomaticIssuanceWorker(
        {
          automaticTargetOutboxId: automaticItem.id,
          automaticOwnedFolioResume: "true",
        } as unknown as {
          automaticTargetOutboxId: string;
          automaticOwnedFolioResume: boolean;
        },
        dependencies,
      ),
      /DTE_AUTOMATIC_OWNED_FOLIO_RESUME_INVALID/,
    );
    assert.equal(claimedOptions.length, 0);

    assert.deepEqual(
      await runOneAutomaticIssuanceWorker(
        {
          automaticTargetOutboxId: automaticItem.id,
          automaticOwnedFolioResume: true,
        },
        dependencies,
      ),
      processed,
    );
    assert.deepEqual(claimedOptions, [{
      automaticTargetOutboxId: automaticItem.id,
      automaticOwnedFolioResume: true,
    }]);
  } finally {
    restore();
  }
});

test("pre-network legal recovery is exact and cannot combine with owned-folio recovery", async () => {
  const restore = preserveWorkerEnv();
  const claimedOptions: Array<{
    automaticTargetOutboxId?: string;
    automaticOwnedFolioResume?: boolean;
    automaticPreNetworkResume?: boolean;
  }> = [];
  try {
    process.env.DTE_PRODUCTION_ENABLED = "true";
    process.env.DTE_AUTOMATIC_WORKER_ENABLED = "true";
    const dependencies: DteWorkerDependencies = {
      claimManual: async () => null,
      claimAutomatic: async (options) => {
        claimedOptions.push(options);
        return automaticItem;
      },
      processClaimed: async () => processed,
    };
    await assert.rejects(
      runOneAutomaticIssuanceWorker(
        { automaticPreNetworkResume: true },
        dependencies,
      ),
      /DTE_AUTOMATIC_PRE_NETWORK_RESUME_TARGET_REQUIRED/,
    );
    await assert.rejects(
      runOneAutomaticIssuanceWorker(
        {
          automaticTargetOutboxId: automaticItem.id,
          automaticPreNetworkResume: true,
          automaticOwnedFolioResume: true,
        },
        dependencies,
      ),
      /DTE_AUTOMATIC_RESUME_MODE_CONFLICT/,
    );
    assert.equal(claimedOptions.length, 0);

    assert.deepEqual(
      await runOneAutomaticIssuanceWorker(
        {
          automaticTargetOutboxId: automaticItem.id,
          automaticPreNetworkResume: true,
        },
        dependencies,
      ),
      processed,
    );
    assert.deepEqual(claimedOptions, [{
      automaticTargetOutboxId: automaticItem.id,
      automaticPreNetworkResume: true,
    }]);
  } finally {
    restore();
  }
});
