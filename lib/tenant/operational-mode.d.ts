import type {
  TenantOperationalCapabilities,
  TenantOperationalMode,
} from "./operational-types";

export const TENANT_OPERATIONAL_MODES: readonly TenantOperationalMode[];
/** Legacy presentation map. Productive execution requires the DB resolver. */
export function resolveTenantOperationalCapabilities(input: {
  lifecycleStatus?: string | null;
  operationalMode?: string | null;
}): TenantOperationalCapabilities & { bheAutomation: false };
export function isSafeDemoAppointmentMode(
  capabilities: Partial<TenantOperationalCapabilities> | null | undefined,
): boolean;
export function canRunAppointmentOperationalEffects(
  capabilities: Partial<TenantOperationalCapabilities> | null | undefined,
): boolean;
