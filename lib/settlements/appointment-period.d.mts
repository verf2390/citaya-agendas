export type SettlementPeriodUnit = "month" | "week";

export const SETTLEMENT_TIME_ZONE: "America/Santiago";
export function settlementToday(): string;
export function settlementAppointmentPeriod(date: string, period: string): {
  start: string;
  end: string;
  previousDate: string;
  nextDate: string;
  label: string;
} | null;
