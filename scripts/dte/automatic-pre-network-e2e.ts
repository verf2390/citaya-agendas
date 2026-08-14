import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomUUID,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ImportedCaf } from "@/lib/dte/certification/caf-secure-import";
import {
  processClaimedDteItem,
  runOneAutomaticIssuanceWorker,
  type ClaimedOutbox,
} from "@/lib/dte/automation/worker";
import { SupabasePrivateDteArtifactStore } from "@/lib/dte/production/artifact-store";
import { CertifiedProductionDteGenerator } from "@/lib/dte/production/generator";
import { loadValidatedProductionSigningMaterial } from "@/lib/dte/production/signing-material";
import { ProductionDteService } from "@/lib/dte/production/service";
import type {
  IProductionSiiClient,
  ProductionStatusResult,
  ProductionUploadResult,
} from "@/lib/dte/production/sii-client";
import { SupabaseProductionDteRepository } from "@/lib/dte/production/supabase-repository";

const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY);
const FIXTURE_ROOT = "/tmp/citaya-dte-auto-fixtures";
let issuerRut = "76000000-0";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const TOTAL = 5000;
const NET = 4202;
const TAX = 798;

const originalFetch = globalThis.fetch;
let externalFetchAttempts = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (
    ["http:", "https:"].includes(url.protocol) &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost"
  ) {
    externalFetchAttempts += 1;
    throw new Error(`OFFLINE_E2E_EXTERNAL_FETCH_BLOCKED:${url.protocol}:${url.hostname}`);
  }
  return originalFetch(input, init);
};

type FixtureCaf = ImportedCaf & {
  materialKind: "production_real";
  trustStatus: "verified_official";
  realUseBlocked: false;
};

type PaymentFixture = {
  appointmentId: string;
  paymentIntentId: string;
  providerPaymentId: string;
  dteType: 33 | 39;
  customerId: string;
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureRut(seed: string) {
  const suffix = Number.parseInt(seed.replaceAll("-", "").slice(0, 6), 16) % 1_000_000;
  const body = `77${String(suffix).padStart(6, "0")}`;
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const raw = 11 - (sum % 11);
  const verifier = raw === 11 ? "0" : raw === 10 ? "K" : String(raw);
  return `${body}-${verifier}`;
}

function cafFixture(dteType: 33 | 39, rangeFrom: number, rangeTo: number): FixtureCaf {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const jwk = createPublicKey(keys.publicKey).export({ format: "jwk" }) as {
    n: string;
    e: string;
  };
  const da =
    `<DA><RE>${issuerRut}</RE><RS>EMISOR OFFLINE SPA</RS><TD>${dteType}</TD>` +
    `<RNG><D>${rangeFrom}</D><H>${rangeTo}</H></RNG><FA>2026-08-01</FA>` +
    `<RSAPK><M>${Buffer.from(jwk.n, "base64url").toString("base64")}</M>` +
    `<E>${Buffer.from(jwk.e, "base64url").toString("base64")}</E></RSAPK>` +
    `<IDK>100</IDK></DA>`;
  const signer = createSign("RSA-SHA1");
  signer.update(Buffer.from(da, "latin1"));
  const cafXml =
    `<CAF version="1.0">${da}` +
    `<FRMA algoritmo="SHA1withRSA">${signer.sign(keys.privateKey, "base64")}</FRMA>` +
    `</CAF>`;
  const originalXml =
    `<?xml version="1.0" encoding="ISO-8859-1"?>` +
    `<AUTORIZACION>${cafXml}` +
    `<RSASK>${keys.privateKey.trim()}</RSASK>` +
    `<RSAPUBK>${keys.publicKey.trim()}</RSAPUBK></AUTORIZACION>`;
  const bytes = Buffer.from(originalXml, "latin1");
  return {
    sourcePath: `/tmp/offline-${dteType}.xml`,
    originalBytes: bytes,
    originalXml,
    cafXml,
    cafBytes: Buffer.from(cafXml, "latin1"),
    daXml: da,
    daBytes: Buffer.from(da, "latin1"),
    issuerRut,
    issuerName: "EMISOR OFFLINE SPA",
    typeCode: dteType,
    rangeFrom,
    rangeTo,
    authorizationDate: "2026-08-01",
    idk: "100",
    privateKeyPem: keys.privateKey,
    publicKeyPem: keys.publicKey,
    sha256: sha256(bytes),
    logicalIdentity: sha256(`${issuerRut}|${dteType}|${rangeFrom}|${rangeTo}`),
    materialKind: "production_real",
    trustStatus: "verified_official",
    fixtureKey: false,
    weakLegacyFixture: false,
    realUseBlocked: false,
  };
}

function signingFixture(tenantId: string) {
  const tenantRoot = join(FIXTURE_ROOT, "certificate", tenantId);
  mkdirSync(tenantRoot, { recursive: true, mode: 0o700 });
  const certificatePath = join(tenantRoot, "certificate.pem");
  const privateKeyPath = join(tenantRoot, "private-key.pem");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-keyout", privateKeyPath,
      "-out", certificatePath, "-nodes", "-days", "30",
      "-subj", `/CN=Offline DTE Fixture/serialNumber=${issuerRut}/C=CL`,
    ],
    { stdio: "ignore" },
  );
  chmodSync(certificatePath, 0o600);
  chmodSync(privateKeyPath, 0o600);
  return { certificatePath, privateKeyPath };
}

async function ok<T>(promise: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>) {
  const result = await promise;
  if (result.error) throw new Error(`FIXTURE_DB_ERROR:${result.error.code ?? ""}:${result.error.message}`);
  return result.data;
}

async function insert(client: SupabaseClient, table: string, value: unknown) {
  await ok(client.from(table).insert(value) as never);
}

async function seedTenant(
  client: SupabaseClient,
  tenantId: string,
  cafs: Map<33 | 39, FixtureCaf>,
) {
  await insert(client, "tenants", {
    id: tenantId,
    slug: `dte-auto-offline-${tenantId.slice(0, 8)}`,
    name: "DTE Automatic Offline Fixture",
    lifecycle_status: "active",
    operational_mode: "live",
  });
  await insert(client, "tenant_billing_settings", {
    tenant_id: tenantId,
    legal_name: "EMISOR OFFLINE SPA",
    tax_id: issuerRut,
    business_activity: "SERVICIOS DIGITALES",
    tax_address: "DIRECCION OFFLINE 100",
    tax_commune: "COQUIMBO",
    tax_city: "COQUIMBO",
  });
  await insert(client, "dte_production_tenant_settings", {
    tenant_id: tenantId,
    enabled: true,
    issuer_rut: issuerRut,
    issuer_legal_name: "EMISOR OFFLINE SPA",
    issuer_activity: "SERVICIOS DIGITALES",
    issuer_activity_code: "620900",
    issuer_address: "DIRECCION OFFLINE 100",
    issuer_commune: "COQUIMBO",
    issuer_city: "COQUIMBO",
    resolution_date: "2026-08-01",
    resolution_number: "80",
    sii_office: "LA SERENA",
    sender_rut: issuerRut,
    certificate_secret_ref: "offline-fixture-only",
    certificate_valid_from: "2026-08-01T00:00:00.000Z",
    certificate_valid_to: "2026-09-30T00:00:00.000Z",
    issuer_profile_state: "ready_for_issuance",
    authorized_types: [33, 39],
    sii_authorization_status: "approved",
    issuance_mode: "automatic",
  });
  await insert(client, "dte_tenant_issuance_settings", {
    tenant_id: tenantId,
    issuance_mode: "automatic_on_verified_payment",
    consumer_document_type: "39",
    invoice_on_request: true,
    auto_email_delivery: false,
    tax_treatment: "affected",
    production_enabled: true,
    sii_authorization_status: "approved",
    certificate_ready: true,
    certificate_valid_to: "2026-09-30T00:00:00.000Z",
    caf_ready: true,
    folio_ready: true,
    endpoints_ready: true,
    storage_ready: true,
    worker_ready: true,
    readiness_tests_green: true,
    last_readiness_check: new Date().toISOString(),
    boleta_payment_document_model: "always_issue_boleta",
    boleta_model_verified_at: new Date().toISOString(),
    boleta_model_verified_by: ACTOR_ID,
    boleta_model_evidence_reference: "offline-disposable-fixture",
  });
  await insert(client, "dte_tenant_readiness_evidence", {
    tenant_id: tenantId,
    issuer_profile_complete: true,
    secure_production_root_ready: true,
    certificate_valid: true,
    certificate_rut_match: true,
    private_key_matches_certificate: true,
    trust_anchor_valid: true,
    private_bucket_ready: true,
    persistence_ready: true,
    ledger_ready: true,
    tenant_isolation_valid: true,
    worker_tenant_aware: true,
    idempotency_ready: true,
    caf_procedures_ready: true,
    production_caf_root_ready: true,
    certificate_sha256: "b".repeat(64),
    certificate_public_key_sha256: "c".repeat(64),
    trust_anchor_sha256: "a".repeat(64),
    trust_anchor_acquisition_ready: true,
    caf_import_fail_closed: true,
    issuer_legal_name_match: true,
    official_xsd_valid: true,
    xmldsig_valid: true,
    production_endpoints_valid: true,
    migrations_applied: true,
    offline_preflight_complete: true,
  });
  await insert(client, "dte_sii_authorization_evidence", {
    tenant_id: tenantId,
    issuer_rut: issuerRut,
    authorization_date: "2026-08-01",
    authorized_types: [33, 39],
    evidence_source: "offline fixture only",
    evidence_fingerprint: sha256(`${tenantId}|authorization`),
    registered_by: ACTOR_ID,
    observation: "Disposable offline fixture; no SII contact.",
    status: "current",
  });
  await insert(client, "dte_legal_activation", [33, 39].map((dteType) => ({
    tenant_id: tenantId,
    dte_type: dteType,
    status: "active",
    activated_by: ACTOR_ID,
    activated_at: new Date().toISOString(),
    gate_snapshot: { offlineFixture: true },
  })));
  for (const dteType of [33, 39] as const) {
    const caf = cafs.get(dteType)!;
    const cafId = randomUUID();
    await insert(client, "dte_production_cafs", {
      id: cafId,
      tenant_id: tenantId,
      dte_type: dteType,
      issuer_rut: issuerRut,
      range_from: caf.rangeFrom,
      range_to: caf.rangeTo,
      authorization_date: caf.authorizationDate,
      sha256: caf.sha256,
      logical_identity: caf.logicalIdentity,
      secure_ref: `offline-fixture:${dteType}:${tenantId}`,
      trust_status: "verified_official",
      active: true,
      environment: "production",
      status: "active",
    });
    await insert(client, "dte_production_folio_ledger",
      Array.from({ length: caf.rangeTo - caf.rangeFrom + 1 }, (_, index) => ({
        tenant_id: tenantId,
        dte_type: dteType,
        folio: caf.rangeFrom + index,
        caf_id: cafId,
        state: "available",
      })),
    );
  }
}

async function seedPayment(
  client: SupabaseClient,
  tenantId: string,
  dteType: 33 | 39,
  label: string,
): Promise<PaymentFixture> {
  const customerId = randomUUID();
  const phone = `+569${(parseInt(customerId.slice(0, 8), 16) % 100_000_000).toString().padStart(8, "0")}`;
  const customerRut = fixtureRut(customerId);
  const serviceId = randomUUID();
  const appointmentId = randomUUID();
  const saleId = randomUUID();
  const scheduleId = randomUUID();
  const paymentIntentId = randomUUID();
  const providerPaymentId = `offline-${label}-${randomUUID()}`;
  await insert(client, "customers", {
    id: customerId,
    tenant_id: tenantId,
    full_name: dteType === 39 ? "Cliente Comercial Preservado" : "RECEPTOR OFFLINE SPA",
    phone,
    email: `${label}@example.test`,
    rut_normalized: dteType === 39 ? null : customerRut,
  });
  if (dteType === 33) {
    await insert(client, "customer_tax_profiles", {
      tenant_id: tenantId,
      customer_id: customerId,
      rut_normalized: customerRut,
      legal_name: "RECEPTOR OFFLINE SPA",
      business_activity: "SERVICIOS",
      tax_address: "DIRECCION RECEPTOR 200",
      tax_commune: "LA SERENA",
      tax_city: "LA SERENA",
      tax_email: `${label}@example.test`,
    });
  }
  await insert(client, "services", {
    id: serviceId,
    tenant_id: tenantId,
    name: `Servicio offline ${label}`,
    duration_min: 30,
    price: TOTAL,
    tax_treatment: "affected",
    public_description: "Servicio offline",
    tax_description: "Servicio digital offline",
    tax_description_review_status: "approved",
    payment_policy: "full_payment",
    payment_configuration_complete: true,
  });
  await insert(client, "appointments", {
    id: appointmentId,
    tenant_id: tenantId,
    customer_id: customerId,
    customer_name: dteType === 39 ? "Cliente Comercial Preservado" : "RECEPTOR OFFLINE SPA",
    customer_phone: phone,
    customer_email: `${label}@example.test`,
    start_at: "2026-08-20T12:00:00.000Z",
    end_at: "2026-08-20T12:30:00.000Z",
    status: "pending_payment",
    booking_status: "pending_payment",
    service_id: serviceId,
    service_name: `Servicio offline ${label}`,
    price: TOTAL,
    service_price: TOTAL,
    currency: "CLP",
    payment_required: true,
    payment_status: "pending",
    payment_required_amount: TOTAL,
    payment_paid_amount: 0,
    payment_remaining_amount: TOTAL,
    sale_total_amount: TOTAL,
    initial_payment_due: TOTAL,
    balance_due: TOTAL,
    invoice_requested: dteType === 33,
    requested_document_type: dteType,
    tax_document_selection: dteType,
    tax_treatment_snapshot: "affected",
    tax_treatment_status: "READY",
    payment_policy_snapshot: "full_payment",
    customer_rut_snapshot: dteType === 33 ? customerRut : null,
    invoice_receiver_rut: dteType === 33 ? customerRut : null,
    invoice_receiver_legal_name: dteType === 33 ? "RECEPTOR OFFLINE SPA" : null,
    invoice_receiver_activity: dteType === 33 ? "SERVICIOS" : null,
    invoice_receiver_address: dteType === 33 ? "DIRECCION RECEPTOR 200" : null,
    invoice_receiver_commune: dteType === 33 ? "LA SERENA" : null,
    invoice_receiver_city: dteType === 33 ? "LA SERENA" : null,
  });
  await insert(client, "billing_sales", {
    id: saleId,
    tenant_id: tenantId,
    customer_id: customerId,
    status: "PAYMENT_PENDING",
    net_amount: NET,
    tax_amount: TAX,
    total_amount: TOTAL,
    paid_amount: 0,
    requested_document_type: dteType,
    initial_payment_due: TOTAL,
    balance_due: TOTAL,
    payment_state: "UNPAID",
    tax_treatment_status: "READY",
    document_status: "UNCOVERED",
    documented_amount: 0,
    pending_documentation_amount: TOTAL,
  });
  await insert(client, "billing_sale_appointments", {
    tenant_id: tenantId,
    sale_id: saleId,
    appointment_id: appointmentId,
  });
  await insert(client, "billing_payment_schedule", {
    id: scheduleId,
    tenant_id: tenantId,
    sale_id: saleId,
    appointment_id: appointmentId,
    installment_kind: "initial",
    amount: TOTAL,
    status: "PENDING",
    paid_amount: 0,
  });
  await insert(client, "payment_intents", {
    id: paymentIntentId,
    tenant_id: tenantId,
    appointment_id: appointmentId,
    provider: "webpay",
    amount: TOTAL,
    currency: "CLP",
    status: "processing",
    provider_payment_id: providerPaymentId,
    buy_order: `buy-${label}-${tenantId.slice(0, 8)}`,
    session_id: `session-${label}`,
    idempotency_key: `payment-${label}-${tenantId}`,
    billing_payment_schedule_id: scheduleId,
    tax_document_method_classification: "requires_boleta",
  });
  await ok(client.from("billing_sales")
    .update({ payment_intent_id: paymentIntentId })
    .eq("id", saleId)
    .eq("tenant_id", tenantId) as never);
  return { appointmentId, paymentIntentId, providerPaymentId, dteType, customerId };
}

async function finalizePayment(client: SupabaseClient, payment: PaymentFixture) {
  const args = {
    p_intent_id: payment.paymentIntentId,
    p_provider: "webpay",
    p_provider_payment_id: payment.providerPaymentId,
    p_audit_metadata: {
      buy_order: `offline-${payment.paymentIntentId}`,
      session_id: "offline-e2e",
      status: "AUTHORIZED",
      response_code: 0,
      transaction_date: "2026-08-14T12:00:00.000Z",
    },
  };
  const first = await ok(client.rpc("finalize_verified_payment", args) as never);
  const replay = await ok(client.rpc("finalize_verified_payment", args) as never);
  assert.equal(first, true);
  assert.equal(replay, false);
}

async function claim(client: SupabaseClient, tenantId: string): Promise<ClaimedOutbox> {
  const workerId = `offline-worker:${randomUUID()}`;
  const rows = await ok(client.rpc("dte_claim_automatic_issuance_outbox", {
    p_worker_id: workerId,
  }) as never) as unknown as ClaimedOutbox[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenant_id, tenantId);
  assert.equal(rows[0].locked_by, workerId);
  assert.ok(rows[0].claim_token);
  return rows[0];
}

class BoundaryClient implements IProductionSiiClient {
  calls = 0;
  constructor(private readonly mode: "submitted" | "unknown") {}

  async uploadExactlyOnce(
    input: Parameters<IProductionSiiClient["uploadExactlyOnce"]>[0],
  ): Promise<ProductionUploadResult> {
    this.calls += 1;
    await input.milestone("seed_before_fetch");
    if (this.mode === "unknown") throw new Error("NETWORK_RESULT_UNKNOWN");
    return {
      status: "submitted",
      trackId: `OFFLINE-${randomUUID()}`,
      responseSha256: "d".repeat(64),
      responseSafe: { category: "offline_boundary_mock" },
      uploadCount: 1,
      responseBytes: null,
    };
  }

  async queryStatusManually(): Promise<ProductionStatusResult> {
    throw new Error("OFFLINE_E2E_STATUS_FORBIDDEN");
  }
}

function serviceFactory(
  client: SupabaseClient,
  cafs: Map<33 | 39, FixtureCaf>,
  boundary: BoundaryClient,
) {
  return () => new ProductionDteService(
    new SupabaseProductionDteRepository(client as never, process.env),
    new SupabasePrivateDteArtifactStore(
      client as never,
      "dte-production-private",
    ),
    new CertifiedProductionDteGenerator(),
    ({ dteType, expectedSha256 }) => {
      const caf = cafs.get(dteType as 33 | 39);
      if (!caf || caf.sha256 !== expectedSha256) {
        throw new Error("OFFLINE_E2E_CAF_MISMATCH");
      }
      return caf;
    },
    () => boundary,
    async () => {
      throw new Error("OFFLINE_E2E_STATUS_TOKEN_FORBIDDEN");
    },
    process.env,
    process.cwd(),
    async ({ settings }) => {
      loadValidatedProductionSigningMaterial({
        certificatePath: settings.certificatePath,
        privateKeyPath: settings.privateKeyPath,
        config: {
          enabled: true,
          environment: "production",
          signingMode: "production",
          seedUrl: String(process.env.DTE_PRODUCTION_SEED_URL),
          tokenUrl: String(process.env.DTE_PRODUCTION_TOKEN_URL),
          uploadUrl: String(process.env.DTE_PRODUCTION_UPLOAD_URL),
          statusUrl: String(process.env.DTE_PRODUCTION_STATUS_URL),
          storageBucket: "dte-production-private",
          cafRoot: String(process.env.DTE_PRODUCTION_CAF_ROOT),
          certificateRoot: String(process.env.DTE_PRODUCTION_CERTIFICATE_ROOT),
          privateKeyRoot: String(process.env.DTE_PRODUCTION_PRIVATE_KEY_ROOT),
          timeoutMs: 30000,
        },
      });
    },
  );
}

async function rows(
  client: SupabaseClient,
  table: string,
  filters: Record<string, unknown>,
  columns = "*",
) {
  let query = client.from(table).select(columns);
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  return await ok(query as never) as unknown as Array<Record<string, unknown>>;
}

async function validateSuccess(
  client: SupabaseClient,
  tenantId: string,
  payment: PaymentFixture,
  cafs: Map<33 | 39, FixtureCaf>,
) {
  await finalizePayment(client, payment);
  const intentRows = await rows(client, "dte_payment_document_intents", {
    tenant_id: tenantId,
    payment_intent_id: payment.paymentIntentId,
  });
  assert.equal(intentRows.length, 1);
  const intent = intentRows[0];
  const outboxRows = await rows(client, "dte_issuance_outbox", {
    tenant_id: tenantId,
    intent_id: intent.id,
  });
  assert.equal(outboxRows.length, 1);
  const item = await claim(client, tenantId);
  assert.equal(item.intent_id, intent.id);
  const boundary = new BoundaryClient("submitted");
  const result = await processClaimedDteItem(item, {
    createProductionService: serviceFactory(client, cafs, boundary),
  });
  assert.equal(result.status, "SUBMITTED");
  assert.equal(boundary.calls, 1);
  const documents = await rows(client, "dte_production_documents", {
    tenant_id: tenantId,
    business_operation_id: `intent:${intent.id}`,
  });
  assert.equal(documents.length, 1);
  const document = documents[0];
  const attempts = await rows(client, "dte_production_submission_attempts", {
    tenant_id: tenantId,
    document_id: document.id,
  });
  const artifacts = await rows(client, "dte_production_artifacts", {
    tenant_id: tenantId,
    document_id: document.id,
  });
  const logicalFolios = await rows(client, "dte_production_folio_ledger", {
    tenant_id: tenantId,
    dte_type: payment.dteType,
    business_operation_id: `intent:${intent.id}`,
  });
  const finalOutbox = await rows(client, "dte_issuance_outbox", {
    tenant_id: tenantId,
    intent_id: intent.id,
  });
  assert.equal(attempts.length, 1);
  assert.ok(attempts[0].before_fetch_at);
  assert.equal(artifacts.filter((artifact) =>
    ["dte_xml", "envio_xml", "pdf"].includes(String(artifact.kind))).length, 3);
  assert.equal(logicalFolios.length, 1);
  assert.equal(finalOutbox.length, 1);
  assert.equal(finalOutbox[0].status, "COMPLETED");
  assert.equal(finalOutbox[0].network_attempts, 1);

  if (payment.dteType === 39) {
    const commercial = await rows(client, "dte_boleta39_commercial_customer_snapshots", {
      tenant_id: tenantId,
      intent_id: intent.id,
    });
    assert.equal(commercial.length, 1);
    assert.equal(commercial[0].customer_name, "Cliente Comercial Preservado");
    assert.equal(commercial[0].customer_rut, null);
    const xmlArtifact = artifacts.find((artifact) => artifact.kind === "dte_xml");
    assert.ok(xmlArtifact);
    const downloaded = await client.storage
      .from("dte-production-private")
      .download(String(xmlArtifact.storage_key));
    if (downloaded.error || !downloaded.data) throw new Error("OFFLINE_E2E_STORAGE_READ_FAILED");
    const xml = Buffer.from(await downloaded.data.arrayBuffer()).toString("latin1");
    assert.match(xml, /<RUTRecep>66666666-6<\/RUTRecep>/);
    assert.match(xml, /<RznSocRecep>Consumidor Final<\/RznSocRecep>/);
  }
  return { intentId: String(intent.id), documentId: String(document.id) };
}

async function validateUnknown(
  client: SupabaseClient,
  tenantId: string,
  payment: PaymentFixture,
  cafs: Map<33 | 39, FixtureCaf>,
) {
  await finalizePayment(client, payment);
  const item = await claim(client, tenantId);
  const boundary = new BoundaryClient("unknown");
  const result = await processClaimedDteItem(item, {
    createProductionService: serviceFactory(client, cafs, boundary),
  });
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(boundary.calls, 1);
  const intent = (await rows(client, "dte_payment_document_intents", {
    id: item.intent_id,
    tenant_id: tenantId,
  }))[0];
  const outbox = (await rows(client, "dte_issuance_outbox", {
    id: item.id,
    tenant_id: tenantId,
  }))[0];
  assert.equal(intent.status, "AMBIGUOUS");
  assert.equal(intent.network_attempt_count, 1);
  assert.equal(outbox.status, "AMBIGUOUS");
  assert.equal(outbox.network_attempts, 1);
  const documents = await rows(client, "dte_production_documents", {
    tenant_id: tenantId,
    business_operation_id: `intent:${item.intent_id}`,
  });
  assert.equal(documents.length, 1);
  const attempts = await rows(client, "dte_production_submission_attempts", {
    tenant_id: tenantId,
    document_id: documents[0].id,
  });
  const logicalFolios = await rows(client, "dte_production_folio_ledger", {
    tenant_id: tenantId,
    dte_type: 33,
    business_operation_id: `intent:${item.intent_id}`,
  });
  assert.equal(attempts.length, 1);
  assert.equal(logicalFolios.length, 1);
  const secondClaim = await ok(client.rpc("dte_claim_automatic_issuance_outbox", {
    p_worker_id: `offline-reclaim:${randomUUID()}`,
  }) as never) as unknown as ClaimedOutbox[];
  assert.equal(secondClaim.length, 0);
  const replayBoundary = new BoundaryClient("submitted");
  await assert.rejects(
    processClaimedDteItem(item, {
      createProductionService: serviceFactory(client, cafs, replayBoundary),
    }),
    /DTE_AUTOMATIC_CLAIM_FENCED/,
  );
  assert.equal(replayBoundary.calls, 0);
  assert.equal((await rows(client, "dte_production_submission_attempts", {
    tenant_id: tenantId,
    document_id: documents[0].id,
  })).length, 1);
  assert.equal((await rows(client, "dte_production_folio_ledger", {
    tenant_id: tenantId,
    dte_type: 33,
    business_operation_id: `intent:${item.intent_id}`,
  })).length, 1);
}

async function validateStaleWorker(
  client: SupabaseClient,
  tenantId: string,
  payment: PaymentFixture,
  cafs: Map<33 | 39, FixtureCaf>,
) {
  await finalizePayment(client, payment);
  const item = await claim(client, tenantId);
  await ok(client.from("dte_issuance_outbox")
    .update({ claim_token: randomUUID() })
    .eq("id", item.id)
    .eq("tenant_id", tenantId) as never);
  const boundary = new BoundaryClient("submitted");
  await assert.rejects(
    processClaimedDteItem(item, {
      createProductionService: serviceFactory(client, cafs, boundary),
    }),
    /DTE_AUTOMATIC_CLAIM_FENCED/,
  );
  assert.equal(boundary.calls, 0);
  assert.equal((await rows(client, "dte_production_documents", {
    tenant_id: tenantId,
    business_operation_id: `intent:${item.intent_id}`,
  })).length, 0);
}

async function main() {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(join(FIXTURE_ROOT, "caf"), { recursive: true, mode: 0o700 });
  writeFileSync(join(FIXTURE_ROOT, "anchor.pem"), "offline fixture only\n", { mode: 0o600 });
  const client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const tenantId = randomUUID();
  issuerRut = fixtureRut(tenantId);
  signingFixture(tenantId);
  const cafs = new Map<33 | 39, FixtureCaf>([
    [33, cafFixture(33, 33001, 33008)],
    [39, cafFixture(39, 39001, 39008)],
  ]);
  await seedTenant(client, tenantId, cafs);

  const automaticDefault = await runOneAutomaticIssuanceWorker({
    claimManual: async () => { throw new Error("DEFAULT_OFF_CLAIM_CALLED"); },
    claimAutomatic: async () => { throw new Error("DEFAULT_OFF_CLAIM_CALLED"); },
    processClaimed: async () => { throw new Error("DEFAULT_OFF_PROCESS_CALLED"); },
  });
  assert.equal(automaticDefault.status, "DISABLED");

  const payment33 = await seedPayment(client, tenantId, 33, "auto33");
  const success33 = await validateSuccess(client, tenantId, payment33, cafs);
  const payment39 = await seedPayment(client, tenantId, 39, "auto39");
  const success39 = await validateSuccess(client, tenantId, payment39, cafs);
  const unknown = await seedPayment(client, tenantId, 33, "unknown");
  await validateUnknown(client, tenantId, unknown, cafs);
  const stale = await seedPayment(client, tenantId, 33, "stale");
  await validateStaleWorker(client, tenantId, stale, cafs);

  assert.equal(externalFetchAttempts, 0);
  const storageObjects = await rows(client, "dte_production_artifacts", {
    tenant_id: tenantId,
  });
  assert.ok(storageObjects.length >= 6);

  console.log(JSON.stringify({
    AUTO_33_PRENETWORK_E2E: "PASS",
    AUTO_39_PRENETWORK_E2E: "PASS",
    POSTGREST: "PASS",
    STORAGE: "PASS",
    SHARED_WORKER: "PASS",
    ONE_INTENT_OUTBOX: "PASS",
    ONE_LOGICAL_FOLIO: "PASS",
    STALE_WORKER_FENCED: "PASS",
    NETWORK_UNKNOWN_SAFE: "PASS",
    AUTOMATIC_DEFAULT_OFF: "PASS",
    externalFetchAttempts,
    success33,
    success39,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
