export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireHostTenantAdmin } from "@/lib/api/requireTenantAdmin";
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
};
type CafRow = { dte_type: number; active: boolean };
type FolioRow = { dte_type: number; state: string };
type DocumentIntentRow = {
  id: string; resolved_dte_type: number | null; amount_snapshot: number; status: string;
  safe_blocking_reason: string | null; production_document_id: string | null;
  receiver_snapshot: { legalName?: string } | null;
  appointment_snapshot: { customerName?: string } | null; created_at: string;
};
type OperationalReadinessRow = {
  ready_for_declaration: boolean;
  ready_for_issuance: boolean;
  production_caf_count: number;
  available_folio_count: number;
};
type ReadinessEvidenceRow = {
  trust_anchor_valid: boolean;
  trust_anchor_sha256: string | null;
  trust_anchor_acquisition_ready: boolean;
  caf_import_fail_closed: boolean;
};
type IssuerProfileRow = {
  issuer_profile_state: string;
  enabled: boolean;
};

function text(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function statusLabel(input: { ready: boolean; missing: number; globalEnabled: boolean }) {
  if (input.ready && input.globalEnabled) return "Listo para emitir";
  if (input.ready) return "Preparado, pendiente de activación";
  if (input.missing > 0) return `Faltan ${input.missing} pasos`;
  return "Desactivado";
}

async function loadState(tenantId: string, authMode: string) {
  const [
    billingResult,
    configResult,
    cafResult,
    folioResult,
    documentsResult,
    operationalReadinessResult,
    readinessEvidenceResult,
    issuerProfileResult,
  ] = await Promise.all([
    supabaseAdmin.from("tenant_billing_settings").select(BILLING_COLUMNS).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("dte_tenant_issuance_settings").select(CONFIG_COLUMNS).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("dte_production_cafs").select("dte_type,active").eq("tenant_id", tenantId),
    supabaseAdmin.from("dte_production_folio_ledger").select("dte_type,state").eq("tenant_id", tenantId),
    supabaseAdmin.from("dte_payment_document_intents").select("id,resolved_dte_type,amount_snapshot,status,safe_blocking_reason,production_document_id,receiver_snapshot,appointment_snapshot,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(12),
    supabaseAdmin.rpc("dte_tenant_operational_readiness", {
      p_tenant_id: tenantId,
    }),
    supabaseAdmin
      .from("dte_tenant_readiness_evidence")
      .select("trust_anchor_valid,trust_anchor_sha256,trust_anchor_acquisition_ready,caf_import_fail_closed")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("dte_production_tenant_settings")
      .select("issuer_profile_state,enabled")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  const firstError = [
    billingResult.error,
    configResult.error,
    cafResult.error,
    folioResult.error,
    documentsResult.error,
    operationalReadinessResult.error,
    readinessEvidenceResult.error,
    issuerProfileResult.error,
  ].find(Boolean);
  if (firstError) throw new Error("DTE_TENANT_STATE_UNAVAILABLE");

  const billing = (billingResult.data ?? {}) as Partial<BillingRow>;
  const config = (configResult.data ?? {}) as Partial<ConfigRow>;
  const operationalReadiness = (
    (operationalReadinessResult.data ?? []) as OperationalReadinessRow[]
  )[0];
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
    billing.legal_name && billing.tax_id && billing.business_activity &&
    billing.tax_address && billing.tax_commune,
  );
  const certificateReady = Boolean(
    config.certificate_ready && config.certificate_valid_to &&
    new Date(config.certificate_valid_to).getTime() > now,
  );
  const cafFoliosReady = Boolean(
    config.caf_ready && config.folio_ready &&
    cafs.some((row) => row.active) && folios.some((row) => row.state === "available"),
  );
  const authorizationReady = config.sii_authorization_status === "approved";
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
  const tenantReady = missing === 0 && config.production_enabled === true;
  const globalEnabled = process.env.DTE_PRODUCTION_ENABLED === "true";

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
      label: statusLabel({ ready: tenantReady, missing, globalEnabled }),
      ready: tenantReady && globalEnabled,
      preparedPendingActivation: tenantReady && !globalEnabled,
      missingSteps: missing,
      blockingReason: config.safe_blocking_reason ?? (!globalEnabled ? "Activación legal global pendiente." : null),
    },
    steps,
    policy: {
      issuanceMode: config.issuance_mode ?? "manual",
      consumerDocumentType: config.consumer_document_type ?? "unsupported",
      invoiceOnRequest: config.invoice_on_request ?? true,
      autoEmailDelivery: config.auto_email_delivery ?? false,
      effectiveAutomatic: globalEnabled && tenantReady && config.issuance_mode === "automatic_on_verified_payment",
    },
    tax: {
      legalName: billing.legal_name ?? "",
      taxId: billing.tax_id ?? "",
      businessActivity: billing.business_activity ?? "",
      address: billing.tax_address ?? "",
      commune: billing.tax_commune ?? "",
      city: billing.tax_city ?? "",
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
    },
    declaration: {
      readyForDeclaration: operationalReadiness?.ready_for_declaration === true,
      readyForIssuance: operationalReadiness?.ready_for_issuance === true,
      issuerProfileState:
        issuerProfile.issuer_profile_state ?? "pre_declaration",
      trustAnchorValid: readinessEvidence.trust_anchor_valid === true,
      trustAnchorSha256Pinned: Boolean(readinessEvidence.trust_anchor_sha256),
      trustAnchorAcquisitionReady:
        readinessEvidence.trust_anchor_acquisition_ready === true,
      cafImportFailClosed:
        readinessEvidence.caf_import_fail_closed === true,
      productionCafCount: Number(
        operationalReadiness?.production_caf_count ?? 0,
      ),
      availableFolioCount: Number(
        operationalReadiness?.available_folio_count ?? 0,
      ),
    },
    documents: ((documentsResult.data ?? []) as DocumentIntentRow[]).map((row) => ({
      id: row.id,
      type: row.resolved_dte_type,
      folio: null,
      customer: row.receiver_snapshot?.legalName ?? row.appointment_snapshot?.customerName ?? "Consumidor final",
      amount: row.amount_snapshot,
      status: row.status,
      date: row.created_at,
      blockingReason: row.safe_blocking_reason,
      canView: Boolean(row.production_document_id),
      canDownload: Boolean(row.production_document_id) && ["ACCEPTED", "DELIVERY_PENDING", "DELIVERED"].includes(row.status),
      canQuery: Boolean(row.production_document_id) && ["SUBMITTED", "AMBIGUOUS"].includes(row.status),
    })),
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
  const configPayload = {
    tenant_id: auth.tenantId,
    issuance_mode: issuanceMode,
    consumer_document_type: consumerDocumentType,
    invoice_on_request: body.invoiceOnRequest !== false,
    auto_email_delivery: body.autoEmailDelivery === true,
    tax_treatment: taxTreatment,
    updated_at: new Date().toISOString(),
  };
  const configResult = await supabaseAdmin.from("dte_tenant_issuance_settings").upsert(configPayload, { onConflict: "tenant_id" });
  if (configResult.error) return NextResponse.json({ ok: false, error: "No se pudo guardar la política de emisión." }, { status: 500 });

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
  }

  return NextResponse.json({ ok: true, state: await loadState(auth.tenantId, auth.authMode) });
}
