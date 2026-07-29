import type { ProductionIssuer } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESOLUTION_NUMBER = /^[1-9]\d{0,9}$/;

export function hasValidProductionIssuerResolution(
  issuer: Pick<
    ProductionIssuer,
    "resolutionDate" | "resolutionNumber"
  >,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  const resolutionDate = String(issuer.resolutionDate ?? "").trim();
  const resolutionNumber = String(issuer.resolutionNumber ?? "").trim();
  if (
    !ISO_DATE.test(resolutionDate) ||
    resolutionDate > today ||
    !RESOLUTION_NUMBER.test(resolutionNumber)
  )
    return false;
  const parsed = new Date(`${resolutionDate}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === resolutionDate
  );
}

export function assertValidProductionIssuerResolution(
  issuer: Pick<
    ProductionIssuer,
    "resolutionDate" | "resolutionNumber"
  >,
): void {
  if (!hasValidProductionIssuerResolution(issuer))
    throw new Error("DTE_PRODUCTION_SII_RESOLUTION_INVALID");
}
