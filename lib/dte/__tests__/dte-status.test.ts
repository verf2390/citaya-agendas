import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidDteStatusTransition,
  canTransitionDteStatus,
  getDteStatusDescription,
  getDteStatusLabel,
} from "../status/dte-status";

test("allows safe DTE status transitions", () => {
  assert.equal(canTransitionDteStatus("draft", "xml_generated"), true);
  assert.equal(canTransitionDteStatus("xml_generated", "signed"), true);
  assert.equal(canTransitionDteStatus("signed", "submitted"), true);
  assert.equal(canTransitionDteStatus("submitted", "accepted"), true);
});

test("blocks dangerous DTE status jumps", () => {
  assert.equal(canTransitionDteStatus("draft", "accepted"), false);
  assert.throws(
    () => assertValidDteStatusTransition("draft", "accepted"),
    /Invalid DTE status transition/,
  );
});

test("returns Spanish labels and descriptions", () => {
  assert.equal(getDteStatusLabel("accepted_with_observations"), "Aceptado con observaciones");
  assert.match(getDteStatusDescription("signed"), /folio/);
});
