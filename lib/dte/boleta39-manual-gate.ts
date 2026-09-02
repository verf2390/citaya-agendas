import { supabaseAdmin } from "../supabaseAdmin";
import { loadTenantOperationalContext } from "../tenant/operational-server";
import { normalizeRut } from "./rut";

export type Boleta39GateInput = {
  tenantId: string;
  dteType: 39;
  issuanceOrigin: string;
};

export type Boleta39GateResult = {
  ready: boolean;
  blockingCodes: string[];
  details: {
    tenantActive: boolean;
    operationalMode: string;
    siiAuthorizationStatus: string;
    issuanceMode: string;
    typeAuthorized: boolean;
    productionCafReady: boolean;
    productionCertificateReady: boolean;
    taxIdentityComplete: boolean;
    resolutionConfigured: boolean;
    availableFoliosCount: number;
    originValid: boolean;
    storageReady?: boolean;
    unclearStateBlocked?: boolean;
  };
};

export class Boleta39GateError extends Error {
  constructor(
    public readonly code: string,
    public readonly blockingCodes: string[],
    public readonly details: Boleta39GateResult["details"],
  ) {
    super(code);
    this.name = "Boleta39GateError";
  }
}

export async function checkManualBoleta39IssuanceReadiness(
  input: Boleta39GateInput,
): Promise<Boleta39GateResult> {
  const blockingCodes: string[] = [];
  const details: Boleta39GateResult["details"] = {
    tenantActive: false,
    operationalMode: "unclassified",
    siiAuthorizationStatus: "pending",
    issuanceMode: "disabled",
    typeAuthorized: false,
    productionCafReady: false,
    productionCertificateReady: false,
    taxIdentityComplete: false,
    resolutionConfigured: false,
    availableFoliosCount: 0,
    originValid: input.issuanceOrigin === "manual_admin",
  };

  if (!input.tenantId || typeof input.tenantId !== "string") {
    blockingCodes.push("BOLETA39_TENANT_ID_REQUIRED");
    return { ready: false, blockingCodes, details };
  }

  if (input.dteType !== 39) {
    blockingCodes.push("BOLETA39_TYPE_MISMATCH");
    return { ready: false, blockingCodes, details };
  }

  if (input.issuanceOrigin !== "manual_admin") {
    blockingCodes.push("BOLETA39_MANUAL_ORIGIN_REQUIRED");
  }

  // 1. Operational Tenant Context
  let operational;
  try {
    operational = await loadTenantOperationalContext(input.tenantId);
    details.tenantActive = operational.lifecycleStatus === "active";
    details.operationalMode = operational.operationalMode;
    if (operational.lifecycleStatus !== "active") {
      blockingCodes.push("BOLETA39_TENANT_INACTIVE");
    }
    if (!["live", "internal"].includes(operational.operationalMode)) {
      blockingCodes.push("BOLETA39_TENANT_NOT_AUTHORIZED");
    }
    if (!operational.capabilities.enqueueDte && !operational.capabilities.manualDteEnqueue) {
      blockingCodes.push("BOLETA39_MANUAL_ENQUEUE_BLOCKED");
    }
  } catch {
    blockingCodes.push("BOLETA39_TENANT_NOT_AUTHORIZED");
    return { ready: false, blockingCodes, details };
  }

  // 2. Tenant Settings and Authorization
  const { data: settings } = await supabaseAdmin
    .from("dte_production_tenant_settings")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  if (!settings) {
    blockingCodes.push("BOLETA39_TENANT_NOT_AUTHORIZED");
    return { ready: false, blockingCodes, details };
  }

  const siiAuthStatus = String(settings.sii_authorization_status ?? "pending").toLowerCase();
  details.siiAuthorizationStatus = siiAuthStatus;
  if (siiAuthStatus !== "approved") {
    blockingCodes.push("BOLETA39_SII_AUTHORIZATION_REQUIRED");
  }

  const issuanceMode = String(settings.issuance_mode ?? "disabled").toLowerCase();
  details.issuanceMode = issuanceMode;
  if (issuanceMode !== "manual") {
    blockingCodes.push("BOLETA39_MANUAL_MODE_REQUIRED");
  }

  const authorizedTypes: number[] = Array.isArray(settings.authorized_types)
    ? settings.authorized_types.map(Number)
    : [33];
  const consumerDocType = String(settings.consumer_document_type ?? "");
  const typeAuthorized = authorizedTypes.includes(39) || consumerDocType === "39";
  details.typeAuthorized = typeAuthorized;
  if (!typeAuthorized) {
    blockingCodes.push("BOLETA39_TENANT_NOT_AUTHORIZED");
  }

  const taxComplete = Boolean(
    settings.issuer_rut &&
      settings.issuer_legal_name &&
      settings.issuer_activity &&
      settings.issuer_address &&
      settings.issuer_commune &&
      settings.issuer_city,
  );
  details.taxIdentityComplete = taxComplete;

  const resolutionConfigured = Boolean(
    settings.resolution_date && settings.resolution_number !== null && settings.resolution_number !== undefined,
  );
  details.resolutionConfigured = resolutionConfigured;
  if (!taxComplete || !resolutionConfigured) {
    blockingCodes.push("BOLETA39_TAX_IDENTITY_INCOMPLETE");
  }

  // 3. Certificate Check
  const certValidFrom = settings.certificate_valid_from ? new Date(settings.certificate_valid_from).getTime() : 0;
  const certValidTo = settings.certificate_valid_to ? new Date(settings.certificate_valid_to).getTime() : 0;
  const now = Date.now();
  const certReady = Boolean(
    settings.certificate_secret_ref && certValidFrom > 0 && certValidTo > now,
  );
  details.productionCertificateReady = certReady;
  if (!certReady) {
    blockingCodes.push("BOLETA39_CERTIFICATE_REQUIRED");
  }

  // 4. Production CAF Check (Must be environment = 'production')
  const { data: cafs } = await supabaseAdmin
    .from("dte_production_cafs")
    .select("id, issuer_rut, range_from, range_to, environment, status")
    .eq("tenant_id", input.tenantId)
    .eq("dte_type", 39)
    .eq("environment", "production")
    .eq("status", "active");

  const validCaf = (cafs ?? []).find(
    (caf) =>
      normalizeRut(caf.issuer_rut) === normalizeRut(settings.issuer_rut) &&
      caf.environment === "production",
  );

  details.productionCafReady = Boolean(validCaf);
  if (!validCaf) {
    blockingCodes.push("BOLETA39_CAF_PRODUCTION_REQUIRED");
  } else {
    // Count available folios in ledger
    const { count } = await supabaseAdmin
      .from("dte_production_folio_ledger")
      .select("folio", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("dte_type", 39)
      .eq("caf_id", validCaf.id)
      .in("state", ["available", "AVAILABLE"]);

    details.availableFoliosCount = count ?? 0;
    if (details.availableFoliosCount < 1) {
      blockingCodes.push("BOLETA39_CAF_FOLIOS_EXHAUSTED");
    }
  }

  // 5. Storage Readiness Check
  const storageReady = Boolean(settings.storage_configured ?? true);
  details.storageReady = storageReady;
  if (!storageReady) {
    blockingCodes.push("BOLETA39_STORAGE_NOT_READY");
  }

  // 6. Ambiguous Outbox Check
  const { count: ambiguousCount } = await supabaseAdmin
    .from("dte_issuance_outbox")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("status", "AMBIGUOUS");

  const noAmbiguousOutbox = (ambiguousCount ?? 0) === 0;
  details.unclearStateBlocked = !noAmbiguousOutbox;
  if (!noAmbiguousOutbox) {
    blockingCodes.push("BOLETA39_AMBIGUOUS_OUTBOX_PENDING");
  }

  const ready = blockingCodes.length === 0;
  return { ready, blockingCodes, details };
}

export async function assertManualBoleta39IssuanceReady(
  input: Boleta39GateInput,
): Promise<Boleta39GateResult> {
  const result = await checkManualBoleta39IssuanceReadiness(input);
  if (!result.ready) {
    throw new Boleta39GateError(
      result.blockingCodes[0] ?? "BOLETA39_GATE_BLOCKED",
      result.blockingCodes,
      result.details,
    );
  }
  return result;
}
