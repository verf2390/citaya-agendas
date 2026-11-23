import { DateTime } from "luxon";

export const SETTLEMENT_TIME_ZONE = "America/Santiago";

export function settlementToday() {
  return DateTime.now().setZone(SETTLEMENT_TIME_ZONE).toISODate();
}

export function settlementAppointmentPeriod(date, period) {
  if ((period !== "month" && period !== "week") || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const anchor = DateTime.fromISO(date, { zone: SETTLEMENT_TIME_ZONE, locale: "es-CL" });
  if (!anchor.isValid || anchor.year < 1900 || anchor.year > 9998) return null;

  const start = anchor.startOf(period);
  const end = start.plus(period === "month" ? { months: 1 } : { weeks: 1 }).startOf("day");
  const previous = start.minus(period === "month" ? { months: 1 } : { weeks: 1 });
  const lastDay = end.minus({ days: 1 });
  return {
    start: start.toUTC().toISO(),
    end: end.toUTC().toISO(),
    previousDate: previous.toISODate(),
    nextDate: end.toISODate(),
    label: period === "month" ? start.toFormat("LLLL yyyy") : `${start.toFormat("d LLL")} – ${lastDay.toFormat("d LLL yyyy")}`,
  };
}
