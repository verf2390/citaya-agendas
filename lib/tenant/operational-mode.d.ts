import type {
  TenantOperationalCapabilities,
  TenantOperationalMode,
} from "./operational-types";

export const TENANT_OPERATIONAL_MODES: readonly TenantOperationalMode[];
export function resolveTenantOperationalCapabilities(input: {
  lifecycleStatus?: string | null;
  operationalMode?: string | null;
}): TenantOperationalCapabilities;
export function createDemoSimulation(): {
  ok: true;
  demoSimulation: true;
  ephemeralId: string;
  persisted: false;
  externalContact: false;
  summary: { title: string; message: string };
};
