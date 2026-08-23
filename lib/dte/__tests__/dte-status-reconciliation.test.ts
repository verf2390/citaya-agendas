import assert from "node:assert/strict";
import test from "node:test";

import {
  friendlyDteStatus,
  planSiiStatusReconciliation,
} from "../cutover";
import { parseSiiStatusResponse } from "../sii/sii-status";

test("EPR accepted status is labeled and reconciled idempotently without fiscal mutations", () => {
  const response = parseSiiStatusResponse(
    "<soap:Envelope><soap:Body><return>" +
      "&lt;RESPUESTA&gt;&lt;ESTADO&gt;EPR&lt;/ESTADO&gt;" +
      "&lt;INFORMADOS&gt;1&lt;/INFORMADOS&gt;" +
      "&lt;ACEPTADOS&gt;1&lt;/ACEPTADOS&gt;" +
      "&lt;RECHAZADOS&gt;0&lt;/RECHAZADOS&gt;" +
      "&lt;REPAROS&gt;0&lt;/REPAROS&gt;&lt;/RESPUESTA&gt;" +
    "</return></soap:Body></soap:Envelope>",
  );
  const canonicalSiiStatus = response.status;
  assert.equal(canonicalSiiStatus, "accepted");
  assert.deepEqual(
    {
      informed: response.informedCount,
      accepted: response.acceptedCount,
      rejected: response.rejectedCount,
      objections: response.objectionCount,
    },
    { informed: 1, accepted: 1, rejected: 0, objections: 0 },
  );

  const firstPlan = planSiiStatusReconciliation(
    "SUBMITTED",
    canonicalSiiStatus,
  );
  assert.deepEqual(firstPlan, {
    targetStatus: "ACCEPTED",
    shouldReconcile: true,
  });
  assert.equal(
    friendlyDteStatus("SUBMITTED", null, canonicalSiiStatus),
    "Aceptada por el SII",
  );

  const before = {
    intentStatus: "SUBMITTED",
    documentSiiStatus: "submitted",
    folio: 8,
    folioState: "issued",
    outboxStatus: "COMPLETED",
    artifactHashes: ["xml-hash", "pdf-hash", "response-hash"],
  };
  const after = {
    ...before,
    intentStatus: firstPlan.targetStatus,
    documentSiiStatus: canonicalSiiStatus,
  };
  const secondPlan = planSiiStatusReconciliation(
    after.intentStatus,
    after.documentSiiStatus,
  );
  assert.deepEqual(secondPlan, {
    targetStatus: "ACCEPTED",
    shouldReconcile: false,
  });
  assert.equal(after.folio, before.folio);
  assert.equal(after.folioState, before.folioState);
  assert.equal(after.outboxStatus, before.outboxStatus);
  assert.deepEqual(after.artifactHashes, before.artifactHashes);
});

test("normalized manual Boleta statuses reconcile terminal results and keep processing submitted", () => {
  assert.deepEqual(
    planSiiStatusReconciliation("SUBMITTED", "accepted"),
    { targetStatus: "ACCEPTED", shouldReconcile: true },
  );
  assert.deepEqual(
    planSiiStatusReconciliation(
      "SUBMITTED",
      "accepted_with_observations",
    ),
    { targetStatus: "ACCEPTED_WITH_OBJECTIONS", shouldReconcile: true },
  );
  assert.deepEqual(
    planSiiStatusReconciliation("SUBMITTED", "rejected"),
    { targetStatus: "REJECTED", shouldReconcile: true },
  );
  assert.deepEqual(
    planSiiStatusReconciliation("SUBMITTED", "processing"),
    { targetStatus: "SUBMITTED", shouldReconcile: false },
  );
});
