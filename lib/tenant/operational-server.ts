import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveTenantOperationalCapabilities } from "@/lib/tenant/operational-mode.mjs";
import type {
  TenantOperationalCapabilities,
  TenantOperationalMode,
} from "@/lib/tenant/operational-types";

export class TenantOperationalError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TenantOperationalError";
  }
}

export type TenantOperationalContext = {
  tenantId: string;
  lifecycleStatus: "active" | "archived";
  operationalMode: TenantOperationalMode;
  capabilities: TenantOperationalCapabilities;
};

export async function loadTenantOperationalContext(tenantId: string): Promise<TenantOperationalContext> {
  const { data, error } = await supabaseAdmin.from("tenants")
    .select("id,lifecycle_status,operational_mode")
    .eq("id", tenantId).maybeSingle();
  if (error || !data?.id) throw new TenantOperationalError("TENANT_OPERATIONAL_CONTEXT_UNAVAILABLE");
  const lifecycleStatus = data.lifecycle_status === "archived" ? "archived" : "active";
  const capabilities = resolveTenantOperationalCapabilities({
    lifecycleStatus,
    operationalMode: data.operational_mode,
  });
  return {
    tenantId: data.id,
    lifecycleStatus,
    operationalMode: capabilities.operationalMode,
    capabilities,
  };
}

function requireCapability(
  context: TenantOperationalContext,
  capability: keyof TenantOperationalCapabilities,
  code: string,
) {
  if (context.capabilities[capability] !== true) throw new TenantOperationalError(code);
  return context;
}

export async function requireLiveTenantOperation(tenantId: string) {
  const context = await loadTenantOperationalContext(tenantId);
  if (context.lifecycleStatus !== "active" || context.operationalMode !== "live") {
    throw new TenantOperationalError("TENANT_LIVE_OPERATION_REQUIRED");
  }
  return context;
}

export async function requireInternalTenantOperation(tenantId: string) {
  const context = await loadTenantOperationalContext(tenantId);
  if (context.lifecycleStatus !== "active" || context.operationalMode !== "internal") {
    throw new TenantOperationalError("TENANT_INTERNAL_OPERATION_REQUIRED");
  }
  return context;
}

export async function assertTenantCanCreateAppointment(tenantId: string) {
  return requireCapability(await loadTenantOperationalContext(tenantId), "createAppointment", "TENANT_MODE_APPOINTMENT_BLOCKED");
}

export async function assertTenantCanCreatePayment(tenantId: string) {
  return requireCapability(await loadTenantOperationalContext(tenantId), "createPayment", "TENANT_MODE_PAYMENT_BLOCKED");
}

export async function assertTenantCanEnqueueDte(
  tenantId: string,
  options?: { dteType?: number; issuanceOrigin?: string },
) {
  const context = await loadTenantOperationalContext(tenantId);
  if (
    options?.issuanceOrigin === "manual_admin" &&
    (context.capabilities.enqueueDte === true || context.capabilities.manualDteEnqueue === true)
  ) {
    return context;
  }
  return requireCapability(context, "enqueueDte", "TENANT_MODE_DTE_BLOCKED");
}

export async function assertTenantCanSendExternalCommunication(tenantId: string) {
  return requireCapability(await loadTenantOperationalContext(tenantId), "sendExternalEmail", "TENANT_MODE_EXTERNAL_COMMUNICATION_BLOCKED");
}

export async function assertTenantCanSendCampaign(tenantId: string) {
  return requireCapability(await loadTenantOperationalContext(tenantId), "sendCampaign", "TENANT_MODE_CAMPAIGN_BLOCKED");
}

export async function assertTenantCanRunDteWorker(
  tenantId: string,
  options?: { issuanceOrigin?: string },
) {
  const context = await loadTenantOperationalContext(tenantId);
  if (
    options?.issuanceOrigin === "manual_admin" &&
    (context.capabilities.runDteWorker === true || context.capabilities.manualDteEnqueue === true)
  ) {
    return context;
  }
  return requireCapability(context, "runDteWorker", "TENANT_MODE_DTE_WORKER_BLOCKED");
}

export async function assertTenantCanAdministerTax(tenantId: string) {
  return requireCapability(await loadTenantOperationalContext(tenantId), "taxAdministration", "TENANT_MODE_TAX_ADMIN_BLOCKED");
}

export async function recordTenantOperationalRejection(input: {
  tenantId: string;
  operation: string;
  source: string;
  safeReference?: string | null;
  reasonCode: string;
}) {
  const safeReferenceHash = input.safeReference
    ? createHash("sha256").update(input.safeReference).digest("hex")
    : null;
  await supabaseAdmin.rpc("record_tenant_operational_rejection", {
    p_tenant_id: input.tenantId,
    p_operation: input.operation,
    p_source: input.source,
    p_safe_reference_hash: safeReferenceHash,
    p_reason_code: input.reasonCode,
  });
}
