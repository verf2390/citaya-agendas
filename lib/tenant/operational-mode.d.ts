import type {
  TenantOperationalCapabilities,
  TenantOperationalMode,
} from "./operational-types";

export const TENANT_OPERATIONAL_MODES: readonly TenantOperationalMode[];
export function resolveTenantOperationalCapabilities(input: {
  lifecycleStatus?: string | null;
  operationalMode?: string | null;
}): TenantOperationalCapabilities;
export function isSafeDemoAppointmentMode(
  capabilities: Partial<TenantOperationalCapabilities> | null | undefined,
): boolean;
