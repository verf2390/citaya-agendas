import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRut, validateRut } from "../rut";

test("validates correct Chilean RUT values", () => {
  assert.equal(validateRut("12.345.678-5"), true);
  assert.equal(validateRut("12345678-5"), true);
  assert.equal(normalizeRut("12.345.678-5"), "12345678-5");
});

test("rejects incorrect Chilean RUT values", () => {
  assert.equal(validateRut("12.345.678-0"), false);
  assert.equal(validateRut("not-a-rut"), false);
});
