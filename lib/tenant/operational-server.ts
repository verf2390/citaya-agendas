import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canRunAppointmentOperationalEffects } from "@/lib/tenant/operational-mode.mjs";
import type {
  TenantOperationalCapabilities,
  TenantOperationalMode,
} from "@/lib/tenant/operational-types";

export type TenantTaxDocumentMode =
  | "unconfigured"
  | "citaya_dte"
  | "external_bhe";

export class TenantOperationalError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TenantOperationalError";
  }
}

export type TenantOperationalContext = {
  tenantId: string;
  tenantSlug: string;
  lifecycleStatus: TenantOperationalCapabilities["lifecycleStatus"];
  operationalMode: TenantOperationalMode;
  taxDocumentMode: TenantTaxDocumentMode;
  capabilities: TenantOperationalCapabilities;
};

function isCapabilities(value: unknown): value is TenantOperationalCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.lifecycleStatus === "string"
    && typeof row.operationalMode === "string"
    && typeof row.createAppointment === "boolean"
    && typeof row.createPayment === "boolean"
    && typeof row.sendCampaign === "boolean"
    && typeof row.enqueueDte === "boolean";
}

function isTaxDocumentMode(value: unknown): value is TenantTaxDocumentMode {
  return value === "unconfigured" || value === "citaya_dte" || value === "external_bhe";
}

export async function loadTenantOperationalContext(tenantId: string): Promise<TenantOperationalContext> {
  const [tenantResult, capabilityResult, featureResult] = await Promise.all([
    supabaseAdmin.from("tenants")
      .select("id,slug,lifecycle_status,operational_mode")
      .eq("id", tenantId).maybeSingle(),
    supabaseAdmin.rpc("resolve_tenant_operational_capabilities", {
      p_tenant_id: tenantId,
    }),
    supabaseAdmin.from("tenant_operational_features")
      .select("tax_document_mode")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const data = tenantResult.data;
  const taxDocumentMode = featureResult.data?.tax_document_mode;
  if (
    tenantResult.error ||
    !data?.id ||
    capabilityResult.error ||
    !isCapabilities(capabilityResult.data) ||
    featureResult.error ||
    !isTaxDocumentMode(taxDocumentMode)
  ) {
    throw new TenantOperationalError("TENANT_OPERATIONAL_CONTEXT_UNAVAILABLE");
  }

  const capabilities = capabilityResult.data;
  return {
    tenantId: data.id,
    tenantSlug: String(data.slug ?? "").trim().toLowerCase(),
    lifecycleStatus: capabilities.lifecycleStatus,
    operationalMode: capabilities.operationalMode,
    taxDocumentMode,
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

export async function assertTenantCanConfirmTransfer(tenantId: string) {
  return requireCapability(
    await loadTenantOperationalContext(tenantId),
    "confirmTransfer",
    "TENANT_MODE_TRANSFER_CONFIRMATION_BLOCKED",
  );
}

export async function assertTenantCanVerifyProviderPayment(tenantId: string) {
  return requireCapability(
    await loadTenantOperationalContext(tenantId),
    "acceptPaymentWebhook",
    "TENANT_MODE_PROVIDER_PAYMENT_VERIFICATION_BLOCKED",
  );
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

export async function assertTenantCanRunAppointmentOperationalEffects(tenantId: string) {
  const context = await loadTenantOperationalContext(tenantId);
  if (!canRunAppointmentOperationalEffects(context.capabilities)) {
    throw new TenantOperationalError("TENANT_MODE_APPOINTMENT_COMMUNICATION_BLOCKED");
  }
  return context;
}

export async function assertTenantCanSendCampaign(tenantId: string) {
  return requireCapability(await loadTenantOperationalContext(tenantId), "sendCampaign", "TENANT_MODE_CAMPAIGN_BLOCKED");
}

export async function assertTenantCanRunDteWorker(
  tenantId: string,
  options?: { issuanceOrigin?: string; intentId?: string },
) {
  const context = await loadTenantOperationalContext(tenantId);

  if (
    options?.issuanceOrigin === "manual_admin" &&
    (context.capabilities.runDteWorker === true || context.capabilities.manualDteEnqueue === true)
  ) {
    return context;
  }

  if (
    options?.issuanceOrigin === "automatic_system" &&
    options.intentId &&
    context.capabilities.confirmTransfer === true &&
    context.capabilities.manualDteEnqueue === true
  ) {
    const { data: intent, error: intentError } = await supabaseAdmin
      .from("dte_payment_document_intents")
      .select("trigger_source,payment_intent_id,created_by")
      .eq("tenant_id", tenantId)
      .eq("id", options.intentId)
      .maybeSingle();

    if (
      !intentError &&
      intent?.trigger_source === "manual_verified" &&
      intent.payment_intent_id &&
      intent.created_by
    ) {
      const [{ data: payment, error: paymentError }, { data: evidence, error: evidenceError }] =
        await Promise.all([
          supabaseAdmin
            .from("payment_intents")
            .select("provider,status")
            .eq("tenant_id", tenantId)
            .eq("id", intent.payment_intent_id)
            .maybeSingle(),
          supabaseAdmin
            .from("billing_sale_payments")
            .select("provider,status,verified_by")
            .eq("tenant_id", tenantId)
            .eq("payment_intent_id", intent.payment_intent_id)
            .maybeSingle(),
        ]);

      if (
        !paymentError &&
        !evidenceError &&
        payment?.provider === "manual" &&
        payment?.status === "succeeded" &&
        evidence?.provider === "manual" &&
        evidence?.status === "VERIFIED" &&
        evidence?.verified_by === intent.created_by
      ) {
        return context;
      }
    }
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
