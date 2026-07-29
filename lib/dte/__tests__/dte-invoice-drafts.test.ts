import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { InMemoryPrivateDteArtifactStore } from "../production/artifact-store";
import type {
  ProductionDteGenerator,
  ProductionGeneratedArtifacts,
} from "../production/generator";
import { InMemoryProductionDteRepository } from "../production/repository";
import { ProductionDteService } from "../production/service";
import type {
  ProductionDocument,
  ProductionTenantSettings,
} from "../production/types";
import {
  calculateInvoiceTotals,
  catalogGrossPriceToNet,
  InMemoryPaymentInvoiceCoordinator,
} from "../invoice-drafts";

const issuer = {
  rut: "78195645-7",
  legalName: "Emisor Congelado SpA",
  businessActivity: "Servicios digitales",
  businessActivityCode: "620200",
  address: "Dirección emisor 123",
  commune: "Santiago",
  city: "Santiago",
  resolutionDate: "2026-07-01",
  resolutionNumber: "80",
  siiOffice: "SANTIAGO",
};
const recipient = {
  rut: "11111111-1",
  legalName: "Receptor Congelado SpA",
  businessActivity: "Consultoría",
  address: "Dirección receptor 456",
  commune: "Providencia",
  city: "Santiago",
  email: "tributario@example.test",
};

test("catalog gross lines 14.990 + 29.990 reconcile deterministically to the paid total", () => {
  const result = calculateInvoiceTotals([
    {
      serviceId: "service-a",
      description: "Servicio A",
      quantity: 1,
      unitNetAmount: catalogGrossPriceToNet(14_990),
      pricingMode: "catalog_gross",
      catalogUnitGrossAmount: 14_990,
    },
    {
      serviceId: "service-b",
      description: "Servicio B",
      quantity: 1,
      unitNetAmount: catalogGrossPriceToNet(29_990),
      pricingMode: "catalog_gross",
      catalogUnitGrossAmount: 29_990,
    },
  ]);
  assert.deepEqual(
    result.lines.map((line) => ({
      net: line.netAmount,
      tax: line.taxAmount,
      total: line.totalAmount,
    })),
    [
      { net: 12_597, tax: 2_393, total: 14_990 },
      { net: 25_201, tax: 4_789, total: 29_990 },
    ],
  );
  assert.deepEqual(
    {
      net: result.netAmount,
      tax: result.taxAmount,
      total: result.totalAmount,
    },
    { net: 37_798, tax: 7_182, total: 44_980 },
  );
});

test("mocked worker preparation consumes frozen issuer, recipient, lines and totals after masters change", async () => {
  const tenantId = "tenant-snapshot";
  const repository = new InMemoryProductionDteRepository();
  const operationalSettings: ProductionTenantSettings = {
    tenantId,
    enabled: true,
    issuer,
    senderRut: issuer.rut,
    certificatePath: "/tmp/mock-certificate.pem",
    privateKeyPath: "/tmp/mock-private-key.pem",
    certificateValidFrom: "2026-01-01T00:00:00.000Z",
    certificateValidTo: "2030-01-01T00:00:00.000Z",
    autoEmailDelivery: false,
  };
  repository.seedTenantSettings(operationalSettings);
  await repository.importCaf({
    id: "mock-caf",
    tenantId,
    dteType: 33,
    issuerRut: issuer.rut,
    rangeFrom: 100,
    rangeTo: 100,
    authorizationDate: "2026-07-01",
    sha256: "a".repeat(64),
    logicalIdentity: "b".repeat(64),
    secureRef: "mock:caf",
    trustStatus: "verified_official",
    active: true,
  });
  let generatedDocument: ProductionDocument | null = null;
  const generator: ProductionDteGenerator = {
    async generate(input): Promise<ProductionGeneratedArtifacts> {
      generatedDocument = structuredClone(input.document);
      assert.deepEqual(input.settings.issuer, issuer);
      return {
        dteXml: Buffer.from("<DTE>mock</DTE>"),
        envioXml: Buffer.from("<EnvioDTE>mock</EnvioDTE>"),
        pdf: Buffer.from("%PDF mock"),
        metadata: {
          encoding: "ISO-8859-1",
          xsd: "valid",
          xmlsec1: "valid",
          frmt: "valid",
          xmlnsXsiPhysical: true,
        },
      };
    },
  };
  const service = new ProductionDteService(
    repository,
    new InMemoryPrivateDteArtifactStore(),
    generator,
    () => ({}) as never,
    () => {
      throw new Error("SII_MUST_NOT_BE_CONTACTED");
    },
    async () => {
      throw new Error("STATUS_MUST_NOT_BE_QUERIED");
    },
    {
      NODE_ENV: "test",
      DTE_PRODUCTION_ENABLED: "true",
      DTE_MODE: "production",
      DTE_SII_ENV: "production",
      DTE_SIGNING_MODE: "production",
      DTE_PRODUCTION_SEED_URL: "https://palena.sii.cl/seed",
      DTE_PRODUCTION_TOKEN_URL: "https://palena.sii.cl/token",
      DTE_PRODUCTION_UPLOAD_URL: "https://palena.sii.cl/upload",
      DTE_PRODUCTION_STATUS_URL: "https://palena.sii.cl/status",
      DTE_PRODUCTION_STORAGE_BUCKET: "mock-private",
      DTE_PRODUCTION_CAF_ROOT: "/tmp/mock-caf",
      DTE_PRODUCTION_CERTIFICATE_ROOT: "/tmp/mock-cert",
      DTE_PRODUCTION_PRIVATE_KEY_ROOT: "/tmp/mock-cert",
      DTE_PRODUCTION_TRUST_ANCHOR_IDK: "100",
      DTE_PRODUCTION_TRUST_ANCHOR_PATH: "/tmp/mock-anchor.pem",
      DTE_PRODUCTION_TRUST_ANCHOR_PROVENANCE:
        "official:https://www.sii.cl/mock-only",
      DTE_PRODUCTION_TRUST_ANCHOR_SHA256: "c".repeat(64),
      DTE_PRODUCTION_DATA_KEY: Buffer.alloc(32, 7).toString("base64"),
      DTE_PRODUCTION_TIMEOUT_MS: "30000",
    },
  );
  const frozenLines = [
    { name: "Servicio congelado", quantity: 1, unitPrice: 10_000 },
  ];
  const draft = await service.createDraft(
    {
      tenantId,
      dteType: 33,
      businessOperationId: "intent:frozen-snapshot-001",
      issuerSnapshot: issuer,
      taxSnapshotAt: "2026-07-29T12:00:00.000Z",
      recipient,
      lines: frozenLines,
    },
    "mock-admin",
  );

  repository.seedTenantSettings({
    ...operationalSettings,
    issuer: {
      ...issuer,
      legalName: "Emisor Maestro Modificado",
      address: "Dirección modificada",
    },
  });
  recipient.legalName = "Receptor Maestro Modificado";
  frozenLines[0].name = "Línea maestra modificada";

  await service.prepare(tenantId, draft.id, "mock-worker");
  assert.ok(generatedDocument);
  assert.equal(generatedDocument.issuerSnapshot?.legalName, "Emisor Congelado SpA");
  assert.equal(generatedDocument.recipient.legalName, "Receptor Congelado SpA");
  assert.equal(generatedDocument.lines[0].name, "Servicio congelado");
  assert.deepEqual(
    {
      net: generatedDocument.netAmount,
      tax: generatedDocument.taxAmount,
      total: generatedDocument.totalAmount,
    },
    { net: 10_000, tax: 1_900, total: 11_900 },
  );
});

test("duplicate payment plus manual review leaves one active intent and one executable outbox", () => {
  const coordinator = new InMemoryPaymentInvoiceCoordinator();
  const payment = {
    tenantId: "tenant-a",
    paymentId: "payment-a",
    paymentKey: "webpay:verified-a",
    amount: 95_200,
    currency: "CLP",
    confirmed: true,
    fullPayment: true,
    lines: [
      { description: "Consulta", quantity: 1, unitNetAmount: 30_000 },
      { description: "Tratamiento", quantity: 1, unitNetAmount: 50_000 },
    ],
    issuer,
    recipient,
  };
  const first = coordinator.confirmPayment(payment, false);
  const duplicate = coordinator.confirmPayment(payment, false);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.status, "REVIEW_REQUIRED");
  assert.equal(first.executableOutboxCount, 0);

  const reviewed = coordinator.reviewManually(
    payment.tenantId,
    payment.paymentKey,
    issuer,
    recipient,
  );
  const obsoleteAttempt = coordinator.attemptSupersededIntent(
    payment.tenantId,
    payment.paymentKey,
  );
  assert.equal(reviewed.activeIntentCount, 1);
  assert.equal(reviewed.executableOutboxCount, 1);
  assert.equal(reviewed.enqueueCount, 1);
  assert.equal(obsoleteAttempt.supersededIntentExecutable, false);

  const migration = readFileSync(
    "migrations/202607290004_dte_invoice_drafts_multi_item.sql",
    "utf8",
  );
  const worker = readFileSync("lib/dte/automation/worker.ts", "utf8");
  assert.match(migration, /finalize_dte_invoice_draft/);
  assert.match(migration, /dte_one_active_intent_per_verified_payment/);
  assert.match(migration, /dte_one_productive_document_per_verified_payment/);
  assert.doesNotMatch(worker, /from\("customer_tax_profiles"\)/);
});
