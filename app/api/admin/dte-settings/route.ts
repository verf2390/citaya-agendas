export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
import {
  deriveBillingCompliance,
  type BillingActivationGate,
} from "@/lib/dte/billing-compliance";
import { loadAdminDocumentRows } from "@/lib/dte/admin-document-rows";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BILLING_COLUMNS = [
  "legal_name", "tax_id", "business_activity", "tax_address", "tax_commune",
  "tax_city", "tax_email", "tax_phone", "default_document_type",
].join(",");
const CONFIG_COLUMNS = [
  "tenant_id", "issuance_mode", "consumer_document_type", "invoice_on_request",
  "auto_email_delivery", "tax_treatment", "production_enabled",
  "sii_authorization_status", "certificate_ready", "certificate_valid_to",
  "caf_ready", "folio_ready", "endpoints_ready", "storage_ready", "worker_ready",
  "readiness_tests_green", "last_readiness_check", "safe_blocking_reason",
  "deposit_tax_document_policy_status", "boleta_payment_document_model",
  "boleta_model_verified_at", "boleta_model_verified_by", "boleta_model_evidence_reference",
].join(",");

type BillingRow = {
  legal_name: string | null; tax_id: string | null; business_activity: string | null;
  tax_address: string | null; tax_commune: string | null; tax_city: string | null;
  tax_email: string | null; tax_phone: string | null; default_document_type: string | null;
};
type ConfigRow = {
  issuance_mode: string; consumer_document_type: string; invoice_on_request: boolean;
  auto_email_delivery: boolean; tax_treatment: string; production_enabled: boolean;
  sii_authorization_status: string; certificate_ready: boolean; certificate_valid_to: string | null;
  caf_ready: boolean; folio_ready: boolean; endpoints_ready: boolean; storage_ready: boolean;
  worker_ready: boolean; readiness_tests_green: boolean; last_readiness_check: string | null;
  safe_blocking_reason: string | null;
  deposit_tax_document_policy_status: "unconfigured" | "reviewed" | "enabled";
  boleta_payment_document_model: "unconfigured" | "always_issue_boleta" | "electronic_payment_voucher_as_boleta";
  boleta_model_verified_at: string | null;
  boleta_model_verified_by: string | null;
  boleta_model_evidence_reference: string | null;
};
type CafRow = { dte_type: number; active: boolean };
type FolioRow = { dte_type: number; state: string };
type ReadinessEvidenceRow = {
  trust_anchor_valid: boolean;
  trust_anchor_sha256: string | null;
  trust_anchor_acquisition_ready: boolean;
  caf_import_fail_closed: boolean;
};
type IssuerProfileRow = {
  issuer_profile_state: string;
  enabled: boolean;
  issuer_rut: string | null;
  issuer_legal_name: string | null;
  issuer_activity: string | null;
  issuer_address: string | null;
  issuer_commune: string | null;
  issuer_city: string | null;
};
type MethodTaxPolicyRow = {
  provider: "mercadopago" | "webpay" | "khipu" | "manual";
  classification: "voucher_as_boleta" | "requires_boleta";
};

function text(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

async function loadState(tenantId: string, authMode: string) {
  const globalEnabled = process.env.DTE_PRODUCTION_ENABLED === "true";
  const [
    billingResult,
    configResult,
    methodTaxPoliciesResult,
    cafResult,
    folioResult,
    documentsResult,
    readinessEvidenceResult,
    issuerProfileResult,
    authorizationResult,
    activationResult,
    gate33Result,
    gate56Result,
    gate61Result,
  ] = await Promise.all([
    supabaseAdmin.from("tenant_billing_settings").select(BILLING_COLUMNS).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("dte_tenant_issuance_settings").select(CONFIG_COLUMNS).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_payment_method_tax_policies")
      .select("provider,classification").eq("tenant_id", tenantId).eq("active", true),
    supabaseAdmin.from("dte_production_cafs").select("dte_type,active").eq("tenant_id", tenantId),
    supabaseAdmin.from("dte_production_folio_ledger").select("dte_type,state").eq("tenant_id", tenantId),
    loadAdminDocumentRows(tenantId),
    supabaseAdmin
      .from("dte_tenant_readiness_evidence")
      .select("trust_anchor_valid,trust_anchor_sha256,trust_anchor_acquisition_ready,caf_import_fail_closed")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("dte_production_tenant_settings")
      .select("issuer_profile_state,enabled,issuer_rut,issuer_legal_name,issuer_activity,issuer_address,issuer_commune,issuer_city")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin.from("dte_sii_authorization_evidence")
      .select("authorization_date,authorized_types,evidence_source,evidence_fingerprint,registered_at,status")
      .eq("tenant_id", tenantId).eq("status", "current").maybeSingle(),
    supabaseAdmin.from("dte_legal_activation")
      .select("dte_type,status,activated_at,paused_at,pause_reason")
      .eq("tenant_id", tenantId),
    supabaseAdmin.rpc("dte_activation_gate_report", {
      p_tenant_id: tenantId,
      p_dte_type: 33,
      p_global_feature_enabled: globalEnabled,
    }),
    supabaseAdmin.rpc("dte_activation_gate_report", {
      p_tenant_id: tenantId,
      p_dte_type: 56,
      p_global_feature_enabled: globalEnabled,
    }),
    supabaseAdmin.rpc("dte_activation_gate_report", {
      p_tenant_id: tenantId,
      p_dte_type: 61,
      p_global_feature_enabled: globalEnabled,
    }),
  ]);
  const firstError = [
    billingResult.error,
    configResult.error,
    methodTaxPoliciesResult.error,
    cafResult.error,
    folioResult.error,
    readinessEvidenceResult.error,
    issuerProfileResult.error,
    authorizationResult.error,
    activationResult.error,
    gate33Result.error,
    gate56Result.error,
    gate61Result.error,
  ].find(Boolean);
  if (firstError) throw new Error("DTE_TENANT_STATE_UNAVAILABLE");

  const billing = (billingResult.data ?? {}) as Partial<BillingRow>;
  const config = (configResult.data ?? {}) as Partial<ConfigRow>;
  const readinessEvidence = (
    readinessEvidenceResult.data ?? {}
  ) as Partial<ReadinessEvidenceRow>;
  const issuerProfile = (
    issuerProfileResult.data ?? {}
  ) as Partial<IssuerProfileRow>;
  const folios = (folioResult.data ?? []) as FolioRow[];
  const cafs = (cafResult.data ?? []) as CafRow[];
  const now = Date.now();
  const taxDataReady = Boolean(
    issuerProfile.issuer_legal_name && issuerProfile.issuer_rut &&
    issuerProfile.issuer_activity && issuerProfile.issuer_address &&
    issuerProfile.issuer_commune,
  );
  const certificateReady = Boolean(
    config.certificate_ready && config.certificate_valid_to &&
    new Date(config.certificate_valid_to).getTime() > now,
  );
  const cafFoliosReady = Boolean(
    config.caf_ready && config.folio_ready &&
    cafs.some((row) => row.active) && folios.some((row) => row.state === "available"),
  );
  const authorizedTypes = Array.isArray(authorizationResult.data?.authorized_types)
    ? authorizationResult.data.authorized_types.map(Number)
    : [];
  const activations = activationResult.data ?? [];
  const activeTypes = activations
    .filter((row) => row.status === "active")
    .map((row) => Number(row.dte_type));
  const compliance = deriveBillingCompliance({
    globalProductionEnabled: globalEnabled,
    tenantProductionEnabled: config.production_enabled === true,
    issuerEnabled: issuerProfile.enabled === true,
    issuerProfileState: issuerProfile.issuer_profile_state ?? "pre_declaration",
    authorizationEvidenceCurrent: authorizationResult.data?.status === "current",
    authorizedTypes,
    activeTypes,
    activationGates: {
      33: gate33Result.data as BillingActivationGate,
      56: gate56Result.data as BillingActivationGate,
      61: gate61Result.data as BillingActivationGate,
    },
  });
  const authorizationReady = authorizedTypes.includes(33);
  const automationReady = Boolean(
    config.endpoints_ready && config.storage_ready && config.worker_ready &&
    config.readiness_tests_green,
  );
  const steps = [
    { key: "tax", label: "Datos tributarios", ready: taxDataReady, detail: taxDataReady ? "Identidad tributaria completa." : "Completa RUT, razón social, giro y dirección.", action: "Editar datos" },
    { key: "certificate", label: "Certificado digital", ready: certificateReady, detail: certificateReady ? "Certificado vigente según evidencia persistida." : "Carga y valida un certificado vigente.", action: "Revisar certificado" },
    { key: "caf", label: "CAF y folios", ready: cafFoliosReady, detail: cafFoliosReady ? "Hay CAF activo y folios disponibles." : "Importa CAF oficial y verifica folios disponibles.", action: "Revisar folios" },
    { key: "authorization", label: "Autorización SII", ready: authorizationReady, detail: authorizationReady ? "Aprobación persistida para este tenant." : "No existe evidencia persistida de aprobación para este tenant.", action: "Revisar autorización" },
    { key: "automation", label: "Automatización", ready: automationReady, detail: automationReady ? "Storage, endpoints, worker y pruebas están listos." : "Completa storage, endpoints, worker y pruebas de readiness.", action: "Ver diagnóstico" },
  ];
  const missing = steps.filter((step) => !step.ready).length;
  const tenantReady = compliance.readyForFirstInvoiceFromUi;
  const activationStatuses = activations.map((row) => row.status);
  const overallLabel = compliance.issuanceEnabled
    ? "Emisión activa"
    : activationStatuses.includes("paused")
      ? "Emisión pausada"
      : !authorizationReady
        ? "Autorización pendiente"
        : !certificateReady
          ? "Falta certificado"
          : !cafFoliosReady
            ? "Falta CAF"
            : missing === 0
              ? "Lista para activar"
              : "Autorización pendiente";

  const byType = new Map<number, { available: number; reserved: number; issued: number }>();
  for (const row of folios) {
    const current = byType.get(row.dte_type) ?? { available: 0, reserved: 0, issued: 0 };
    if (row.state === "available") current.available += 1;
    if (row.state === "reserved") current.reserved += 1;
    if (row.state === "issued") current.issued += 1;
    byType.set(row.dte_type, current);
  }

  return {
    globalProductionEnabled: globalEnabled,
    technicalAccess: authMode === "platform_admin",
    status: {
      label: overallLabel,
      ready: tenantReady && globalEnabled,
      preparedPendingActivation: tenantReady && !globalEnabled,
      missingSteps: missing,
      blockingReason: compliance.readyForFirstInvoiceFromUi
        ? null
        : config.safe_blocking_reason ?? (!globalEnabled ? "Activación legal global pendiente." : null),
    },
    steps,
    policy: {
      issuanceMode: config.issuance_mode ?? "manual",
      consumerDocumentType: config.consumer_document_type ?? "unsupported",
      invoiceOnRequest: config.invoice_on_request ?? true,
      autoEmailDelivery: config.auto_email_delivery ?? false,
      effectiveAutomatic: compliance.issuanceEnabled && config.issuance_mode === "automatic_on_verified_payment",
      depositTaxDocumentPolicyStatus: config.deposit_tax_document_policy_status ?? "unconfigured",
      boletaPaymentDocumentModel: config.boleta_payment_document_model ?? "unconfigured",
      boletaModelVerifiedAt: config.boleta_model_verified_at ?? null,
      boletaModelVerifiedBy: config.boleta_model_verified_by ?? null,
      boletaModelEvidenceReference: config.boleta_model_evidence_reference ?? null,
      paymentMethodTaxPolicies: Object.fromEntries(
        ((methodTaxPoliciesResult.data ?? []) as MethodTaxPolicyRow[])
          .map((row) => [row.provider, row.classification]),
      ),
    },
    tax: {
      legalName: issuerProfile.issuer_legal_name ?? billing.legal_name ?? "",
      taxId: issuerProfile.issuer_rut ?? billing.tax_id ?? "",
      businessActivity: issuerProfile.issuer_activity ?? billing.business_activity ?? "",
      address: issuerProfile.issuer_address ?? billing.tax_address ?? "",
      commune: issuerProfile.issuer_commune ?? billing.tax_commune ?? "",
      city: issuerProfile.issuer_city ?? billing.tax_city ?? "",
      email: billing.tax_email ?? "",
      phone: billing.tax_phone ?? "",
      taxTreatment: config.tax_treatment ?? "unconfigured",
    },
    readiness: {
      productionEnabled: config.production_enabled ?? false,
      siiAuthorizationStatus: config.sii_authorization_status ?? "not_configured",
      certificateReady,
      cafReady: cafFoliosReady,
      lastCheck: config.last_readiness_check ?? null,
      folios: Object.fromEntries([...byType.entries()].map(([type, counts]) => [String(type), counts])),
      authorizedTypes,
      authorizationEvidence: authorizationResult.data ?? null,
      activations: activationResult.data ?? [],
    },
    declaration: {
      ...compliance,
      readyForDeclaration: compliance.declarationRegistered,
      readyForIssuance: compliance.issuanceEnabled,
      issuerProfileState:
        issuerProfile.issuer_profile_state ?? "pre_declaration",
      trustAnchorValid: readinessEvidence.trust_anchor_valid === true,
      trustAnchorSha256Pinned: Boolean(readinessEvidence.trust_anchor_sha256),
      trustAnchorAcquisitionReady:
        readinessEvidence.trust_anchor_acquisition_ready === true,
      cafImportFailClosed:
        readinessEvidence.caf_import_fail_closed === true,
      productionCafCount: cafs.filter((row) => row.active).length,
      availableFolioCount: folios.filter(
        (row) => row.state === "available",
      ).length,
    },
    documents: documentsResult,
  };
}

export async function GET(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ ok: true, state: await loadState(auth.tenantId, auth.authMode) });
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo cargar el estado tributario del negocio." }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireHostTenantAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Solicitud inválida" }, { status: 400 });

  const issuanceMode = body.issuanceMode === "automatic_on_verified_payment" ? body.issuanceMode : "manual";
  const consumerDocumentType = ["39", "41", "unsupported"].includes(body.consumerDocumentType) ? body.consumerDocumentType : "unsupported";
  const taxTreatment = ["affected", "exempt", "mixed", "unconfigured"].includes(body.taxTreatment) ? body.taxTreatment : "unconfigured";
  const depositTaxDocumentPolicyStatus = body.depositTaxDocumentPolicyStatus === "reviewed"
    ? "reviewed"
    : "unconfigured";
  const boletaPaymentDocumentModel = [
    "unconfigured", "always_issue_boleta", "electronic_payment_voucher_as_boleta",
  ].includes(body.boletaPaymentDocumentModel)
    ? body.boletaPaymentDocumentModel
    : "unconfigured";
  const boletaModelEvidenceReference = text(body.boletaModelEvidenceReference, 500);
  if (boletaPaymentDocumentModel !== "unconfigured" && boletaModelEvidenceReference.length < 3) {
    return NextResponse.json({ ok: false, error: "Registra una referencia administrativa de la verificación del modelo de boleta." }, { status: 400 });
  }
  const configPayload = {
    tenant_id: auth.tenantId,
    issuance_mode: issuanceMode,
    consumer_document_type: consumerDocumentType,
    invoice_on_request: body.invoiceOnRequest !== false,
    auto_email_delivery: body.autoEmailDelivery === true,
    tax_treatment: taxTreatment,
    deposit_tax_document_policy_status: depositTaxDocumentPolicyStatus,
    boleta_payment_document_model: boletaPaymentDocumentModel,
    boleta_model_verified_at: boletaPaymentDocumentModel === "unconfigured" ? null : new Date().toISOString(),
    boleta_model_verified_by: boletaPaymentDocumentModel === "unconfigured" ? null : auth.userId,
    boleta_model_evidence_reference: boletaPaymentDocumentModel === "unconfigured" ? null : boletaModelEvidenceReference,
    updated_at: new Date().toISOString(),
  };
  const configResult = await supabaseAdmin.from("dte_tenant_issuance_settings").upsert(configPayload, { onConflict: "tenant_id" });
  if (configResult.error) return NextResponse.json({ ok: false, error: "No se pudo guardar la política de emisión." }, { status: 500 });

  const methodPolicies = boletaPaymentDocumentModel === "electronic_payment_voucher_as_boleta" &&
    body.paymentMethodTaxPolicies && typeof body.paymentMethodTaxPolicies === "object"
    ? body.paymentMethodTaxPolicies as Record<string, unknown>
    : {};
  const methodPolicyResults = await Promise.all(
    (["mercadopago", "webpay", "khipu", "manual"] as const).map(async (provider) => {
      const classification = methodPolicies[provider];
      if (!["voucher_as_boleta", "requires_boleta"].includes(String(classification))) {
        return supabaseAdmin.from("tenant_payment_method_tax_policies")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("tenant_id", auth.tenantId).eq("provider", provider);
      }
      return supabaseAdmin.from("tenant_payment_method_tax_policies").upsert({
        tenant_id: auth.tenantId,
        provider,
        classification,
        verified_at: new Date().toISOString(),
        verified_by: auth.userId,
        evidence_reference: boletaModelEvidenceReference,
        active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,provider" });
    }),
  );
  if (methodPolicyResults.some((result) => result.error)) {
    return NextResponse.json({ ok: false, error: "No se pudo guardar la clasificación tributaria de los medios de pago." }, { status: 500 });
  }

  if (body.tax && typeof body.tax === "object") {
    const tax = body.tax;
    const billingPayload = {
      tenant_id: auth.tenantId,
      legal_name: text(tax.legalName), tax_id: text(tax.taxId, 32),
      business_activity: text(tax.businessActivity), tax_address: text(tax.address),
      tax_commune: text(tax.commune, 100), tax_city: text(tax.city, 100),
      tax_email: text(tax.email, 254), tax_phone: text(tax.phone, 32),
      updated_at: new Date().toISOString(),
    };
    const billingResult = await supabaseAdmin.from("tenant_billing_settings").upsert(billingPayload, { onConflict: "tenant_id" });
    if (billingResult.error) return NextResponse.json({ ok: false, error: "No se pudieron guardar los datos tributarios." }, { status: 500 });
    const issuerResult = await supabaseAdmin
      .from("dte_production_tenant_settings")
      .update({
        issuer_legal_name: billingPayload.legal_name,
        issuer_rut: billingPayload.tax_id,
        issuer_activity: billingPayload.business_activity,
        issuer_address: billingPayload.tax_address,
        issuer_commune: billingPayload.tax_commune,
        issuer_city: billingPayload.tax_city,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", auth.tenantId);
    if (issuerResult.error) {
      return NextResponse.json(
        { ok: false, error: "No se pudo actualizar la identidad tributaria maestra." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, state: await loadState(auth.tenantId, auth.authMode) });
}
