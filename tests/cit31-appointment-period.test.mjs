import assert from "node:assert/strict";
import test from "node:test";

import { settlementAppointmentPeriod } from "../lib/settlements/appointment-period.mjs";

test("CIT-31 finds the complete month in Chile and advances across years", () => {
  const period = settlementAppointmentPeriod("2026-12-20", "month");
  assert.equal(period.start, "2026-12-01T03:00:00.000Z");
  assert.equal(period.end, "2027-01-01T03:00:00.000Z");
  assert.equal(period.previousDate, "2026-11-01");
  assert.equal(period.nextDate, "2027-01-01");
});

test("CIT-31 uses calendar weeks and respects Chilean daylight saving", () => {
  const period = settlementAppointmentPeriod("2026-09-06", "week");
  assert.equal(period.start, "2026-08-31T04:00:00.000Z");
  assert.equal(period.end, "2026-09-07T03:00:00.000Z");
  assert.equal(period.previousDate, "2026-08-24");
  assert.equal(period.nextDate, "2026-09-07");
});

test("CIT-31 rejects invalid calendar dates and unsupported periods", () => {
  assert.equal(settlementAppointmentPeriod("2026-02-29", "month"), null);
  assert.equal(settlementAppointmentPeriod("2026-11", "month"), null);
  assert.equal(settlementAppointmentPeriod("2026-11-24", "all"), null);
});
