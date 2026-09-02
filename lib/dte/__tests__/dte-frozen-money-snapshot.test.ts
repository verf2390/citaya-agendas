import assert from "node:assert/strict";
import test from "node:test";

import { buildProductionLinesFromMoneySnapshot } from "../automation/worker";
import { InMemoryPrivateDteArtifactStore } from "../production/artifact-store";
import {
  buildProductionTaxDocumentDraft,
  type ProductionDteGenerator,
} from "../production/generator";
import { InMemoryProductionDteRepository } from "../production/repository";
import { ProductionDteService } from "../production/service";
import type {
  ProductionDraftInput,
  ProductionTenantSettings,
} from "../production/types";
import { buildDtePrintHtml } from "../pdf/build-dte-print-view";
import { buildDteDocumentoXmlLab } from "../xml/build-dte-envelope";

const tenantId = "tenant-frozen-money";
const issuer = {
  rut: "78195645-7",
  legalName: "Emisor Snapshot SpA",
  businessActivity: "Servicios digitales",
  businessActivityCode: "620200",
  address: "Dirección 123",
  commune: "Santiago",
  city: "Santiago",
  resolutionDate: "2026-07-01",
  resolutionNumber: "80",
};
const recipient = {
  rut: "11111111-1",
  legalName: "Receptor Snapshot SpA",
  businessActivity: "Consultoría",
  address: "Dirección 456",
  commune: "Providencia",
  city: "Santiago",
  email: "tributario@example.test",
};

function createContext() {
  const repository = new InMemoryProductionDteRepository();
  const settings: ProductionTenantSettings = {
    tenantId,
    enabled: true,
    issuer,
    senderRut: issuer.rut,
    certificatePath: "/tmp/not-used-certificate.pem",
    privateKeyPath: "/tmp/not-used-private-key.pem",
    certificateValidFrom: "2026-01-01T00:00:00.000Z",
    certificateValidTo: "2030-01-01T00:00:00.000Z",
    autoEmailDelivery: false,
  };
  repository.seedTenantSettings(settings);
  const generator: ProductionDteGenerator = {
    async generate() {
      throw new Error("GENERATOR_MUST_NOT_RUN");
    },
  };
  const service = new ProductionDteService(
    repository,
    new InMemoryPrivateDteArtifactStore(),
    generator,
    () => {
      throw new Error("CAF_MUST_NOT_BE_LOADED");
    },
    () => {
      throw new Error("SII_MUST_NOT_BE_CONTACTED");
    },
    async () => {
      throw new Error("SII_STATUS_MUST_NOT_BE_QUERIED");
    },
    { NODE_ENV: "test" },
  );
  return { repository, service };
}

function draftInput(
  suffix: string,
  lines: ProductionDraftInput["lines"],
  frozenMoneySnapshot?: ProductionDraftInput["frozenMoneySnapshot"],
  dteType: 33 | 39 = 33,
): ProductionDraftInput {
  return {
    tenantId,
    dteType,
    businessOperationId: `intent:frozen-money-${suffix}`,
    issuerSnapshot: issuer,
    taxSnapshotAt: "2026-08-25T12:00:00.000Z",
    recipient,
    lines,
    frozenMoneySnapshot,
  };
}

test("automatic type 33 emits a gross-detail DTE for the immutable 59.440 catalog price", async () => {
  const { repository, service } = createContext();
  const lines = buildProductionLinesFromMoneySnapshot({
    automatic: true,
    dteType: 33,
    rawLines: [{
      description: "Servicio afecto",
      quantity: 1,
      unitNetAmount: 49_950,
      catalogUnitGrossAmount: 59_440,
      grossAmount: 59_440,
      pricingMode: "catalog_gross",
    }],
    netAmount: 49_950,
    exemptAmount: 0,
    taxAmount: 9_490,
    totalAmount: 59_440,
  });
  assert.equal(lines[0].unitPrice, 49_950);
  assert.equal(lines[0].unitGrossAmount, 59_440);
  assert.equal(lines[0].lineGrossAmount, 59_440);
  assert.equal(lines[0].pricingMode, "gross");

  const draft = await service.createDraft(
    draftInput("type-33", lines, {
      source: "automatic_intent_immutable_snapshot",
      amountSnapshot: 59_440,
      netAmount: 49_950,
      exemptAmount: 0,
      taxAmount: 9_490,
      totalAmount: 59_440,
    }),
    "automatic-worker",
  );
  assert.deepEqual(
    {
      netAmount: draft.netAmount,
      exemptAmount: draft.exemptAmount,
      taxAmount: draft.taxAmount,
      totalAmount: draft.totalAmount,
    },
    {
      netAmount: 49_950,
      exemptAmount: 0,
      taxAmount: 9_490,
      totalAmount: 59_440,
    },
  );

  const persisted = await repository.getDocument(tenantId, draft.id);
  assert.ok(persisted);
  assert.equal(persisted.netAmount, 49_950);
  assert.equal(persisted.taxAmount, 9_490);
  assert.equal(persisted.totalAmount, 59_440);

  const taxDraft = buildProductionTaxDocumentDraft({ ...persisted, folio: 1 });
  assert.equal(taxDraft.amountsAreGross, true);
  assert.equal(taxDraft.lines[0].unitPrice, 59_440);
  assert.equal(taxDraft.lines[0].amount, 59_440);
  const xml = buildDteDocumentoXmlLab(taxDraft);
  assert.match(xml, /<MntBruto>1<\/MntBruto>/);
  assert.match(xml, /<MntNeto>49950<\/MntNeto>/);
  assert.match(xml, /<IVA>9490<\/IVA>/);
  assert.match(xml, /<MntTotal>59440<\/MntTotal>/);
  assert.match(xml, /<PrcItem>59440<\/PrcItem>/);
  assert.match(xml, /<MontoItem>59440<\/MontoItem>/);
  const printHtml = buildDtePrintHtml({
    ...taxDraft,
    environment: "PRODUCTION",
    statusLabel: "Borrador",
    tedStatus: "pending",
  });
  assert.match(printHtml, /Neto[\s\S]*\$49\.950/);
  assert.match(printHtml, /IVA[\s\S]*\$9\.490/);
  assert.match(printHtml, /Total[\s\S]*\$59\.440/);
});

test("automatic type 33 recognizes the literal historical production snapshot", async () => {
  const { repository, service } = createContext();
  const lines = buildProductionLinesFromMoneySnapshot({
    automatic: true,
    dteType: 33,
    rawLines: [{
      quantity: 1,
      netAmount: 49_950,
      taxAmount: 9_490,
      description: "Servicios de app minimarket",
      totalAmount: 59_440,
      unitNetAmount: 49_950,
      discountBasisPoints: 0,
    }],
    netAmount: 49_950,
    exemptAmount: 0,
    taxAmount: 9_490,
    totalAmount: 59_440,
  });

  assert.equal(lines[0].unitPrice, 49_950);
  assert.equal(lines[0].pricingMode, "gross");
  assert.equal(lines[0].unitGrossAmount, 59_440);
  assert.equal(lines[0].lineGrossAmount, 59_440);

  const draft = await service.createDraft(
    draftInput("type-33-legacy-gross", lines, {
      source: "automatic_intent_immutable_snapshot",
      amountSnapshot: 59_440,
      netAmount: 49_950,
      exemptAmount: 0,
      taxAmount: 9_490,
      totalAmount: 59_440,
    }),
    "automatic-worker",
  );
  const persisted = await repository.getDocument(tenantId, draft.id);
  assert.ok(persisted);

  const taxDraft = buildProductionTaxDocumentDraft({ ...persisted, folio: 3 });
  const xml = buildDteDocumentoXmlLab(taxDraft);
  assert.match(xml, /<MntBruto>1<\/MntBruto>/);
  assert.match(xml, /<PrcItem>59440<\/PrcItem>/);
  assert.match(xml, /<MontoItem>59440<\/MontoItem>/);
  assert.match(xml, /<MntNeto>49950<\/MntNeto>/);
  assert.match(xml, /<IVA>9490<\/IVA>/);
  assert.match(xml, /<MntTotal>59440<\/MntTotal>/);
});

test("historical production snapshot does not infer gross with explicit net pricing", async () => {
  const { service } = createContext();
  const lines = buildProductionLinesFromMoneySnapshot({
    automatic: true,
    dteType: 33,
    rawLines: [{
      quantity: 1,
      netAmount: 49_950,
      taxAmount: 9_490,
      description: "Servicios de app minimarket",
      totalAmount: 59_440,
      unitNetAmount: 49_950,
      discountBasisPoints: 0,
      pricingMode: "net",
    }],
    netAmount: 49_950,
    exemptAmount: 0,
    taxAmount: 9_490,
    totalAmount: 59_440,
  });

  assert.equal(lines[0].pricingMode, "net");
  await assert.rejects(
    service.createDraft(
      draftInput("type-33-legacy-ambiguous", lines, {
        source: "automatic_intent_immutable_snapshot",
        amountSnapshot: 59_440,
        netAmount: 49_950,
        exemptAmount: 0,
        taxAmount: 9_490,
        totalAmount: 59_440,
      }),
      "automatic-worker",
    ),
    /DTE_FROZEN_MONEY_SNAPSHOT_INVALID/,
  );
});

test("historical production gross inference rejects every incoherent boundary", async () => {
  const { service } = createContext();
  const historicalLine = {
    quantity: 1,
    netAmount: 49_950,
    taxAmount: 9_490,
    description: "Servicios de app minimarket",
    totalAmount: 59_440,
    unitNetAmount: 49_950,
    discountBasisPoints: 0,
  };
  const input = {
    automatic: true,
    dteType: 33 as const,
    netAmount: 49_950,
    exemptAmount: 0,
    taxAmount: 9_490,
    totalAmount: 59_440,
  };
  const frozenMoneySnapshot = {
    source: "automatic_intent_immutable_snapshot" as const,
    amountSnapshot: 59_440,
    netAmount: 49_950,
    exemptAmount: 0,
    taxAmount: 9_490,
    totalAmount: 59_440,
  };

  assert.throws(
    () => buildProductionLinesFromMoneySnapshot({
      ...input,
      rawLines: [{ ...historicalLine, totalAmount: 59_441 }],
    }),
    /DTE_LINES_MONEY_SNAPSHOT_INVALID/,
  );
  assert.throws(
    () => buildProductionLinesFromMoneySnapshot({
      ...input,
      rawLines: [historicalLine, historicalLine],
    }),
    /DTE_LINES_MONEY_SNAPSHOT_INVALID/,
  );
  const discountedLines = buildProductionLinesFromMoneySnapshot({
    ...input,
    rawLines: [{ ...historicalLine, discountBasisPoints: 1 }],
  });
  assert.equal(discountedLines[0].pricingMode, "net");
  await assert.rejects(
    service.createDraft(
      draftInput(
        "type-33-legacy-discount",
        discountedLines,
        frozenMoneySnapshot,
      ),
      "automatic-worker",
    ),
    /DTE_FROZEN_MONEY_SNAPSHOT_INVALID/,
  );

  const incoherentTaxLines = buildProductionLinesFromMoneySnapshot({
    ...input,
    rawLines: [{ ...historicalLine, taxAmount: 9_491 }],
  });
  assert.equal(incoherentTaxLines[0].pricingMode, "net");
  await assert.rejects(
    service.createDraft(
      draftInput(
        "type-33-legacy-tax-mismatch",
        incoherentTaxLines,
        frozenMoneySnapshot,
      ),
      "automatic-worker",
    ),
    /DTE_FROZEN_MONEY_SNAPSHOT_INVALID/,
  );

  const exemptLines = buildProductionLinesFromMoneySnapshot({
    ...input,
    rawLines: [{ ...historicalLine, exempt: true }],
  });
  assert.equal(exemptLines[0].pricingMode, "net");
  assert.equal(exemptLines[0].exempt, true);
  await assert.rejects(
    service.createDraft(
      draftInput(
        "type-33-legacy-exempt",
        exemptLines,
        frozenMoneySnapshot,
      ),
      "automatic-worker",
    ),
    /DTE_FROZEN_MONEY_SNAPSHOT_INVALID/,
  );
});

test("manipulated frozen money and incoherent automatic lines fail closed", async () => {
  const { service } = createContext();
  await assert.rejects(
    service.createDraft(
      draftInput(
        "tampered",
        [{ name: "Servicio alterado", quantity: 1, unitPrice: 49_949 }],
        {
          source: "automatic_intent_immutable_snapshot",
          amountSnapshot: 59_440,
          netAmount: 49_949,
          exemptAmount: 0,
          taxAmount: 9_491,
          totalAmount: 59_440,
        },
      ),
      "automatic-worker",
    ),
    /DTE_FROZEN_MONEY_SNAPSHOT_INVALID/,
  );
  const grossLines = buildProductionLinesFromMoneySnapshot({
    automatic: true,
    dteType: 33,
    rawLines: [{
      description: "Servicio bruto alterado",
      quantity: 1,
      catalogUnitGrossAmount: 59_440,
      grossAmount: 59_440,
      pricingMode: "catalog_gross",
    }],
    netAmount: 49_950,
    exemptAmount: 0,
    taxAmount: 9_490,
    totalAmount: 59_440,
  });
  await assert.rejects(
    service.createDraft(
      draftInput("gross-tampered", grossLines, {
        source: "automatic_intent_immutable_snapshot",
        amountSnapshot: 59_440,
        netAmount: 49_949,
        exemptAmount: 0,
        taxAmount: 9_491,
        totalAmount: 59_440,
      }),
      "automatic-worker",
    ),
    /DTE_FROZEN_MONEY_SNAPSHOT_INVALID/,
  );
  assert.throws(
    () => buildProductionLinesFromMoneySnapshot({
      automatic: true,
      dteType: 33,
      rawLines: [{
        description: "Línea alterada",
        quantity: 1,
        unitGrossAmount: 59_439,
        grossAmount: 59_439,
      }],
      netAmount: 49_950,
      exemptAmount: 0,
      taxAmount: 9_490,
      totalAmount: 59_440,
    }),
    /DTE_LINES_MONEY_SNAPSHOT_INVALID/,
  );
});

test("drafts without frozen money keep the existing strict net calculation", async () => {
  const { repository, service } = createContext();
  const draft = await service.createDraft(
    draftInput("strict", [
      { name: "Servicio neto", quantity: 1, unitPrice: 10_000 },
    ]),
    "admin-user",
  );
  assert.deepEqual(
    {
      netAmount: draft.netAmount,
      taxAmount: draft.taxAmount,
      totalAmount: draft.totalAmount,
    },
    { netAmount: 10_000, taxAmount: 1_900, totalAmount: 11_900 },
  );
  const strictXmlDraft = await service.createDraft(
    draftInput("strict-xml", [
      { name: "Servicio neto XML", quantity: 1, unitPrice: 10_000 },
    ]),
    "admin-user",
  );
  const persisted = await repository.getDocument(tenantId, strictXmlDraft.id);
  assert.ok(persisted);
  const xml = buildDteDocumentoXmlLab(
    buildProductionTaxDocumentDraft({ ...persisted, folio: 2 }),
  );
  assert.doesNotMatch(xml, /<MntBruto>/);
});

test("automatic boleta 39 keeps its existing gross-derived monetary result", async () => {
  const { service } = createContext();
  const lines = buildProductionLinesFromMoneySnapshot({
    automatic: true,
    dteType: 39,
    rawLines: [{
      description: "Boleta afecta",
      quantity: 1,
      unitGrossAmount: 5_000,
      grossAmount: 5_000,
    }],
    netAmount: 4_202,
    exemptAmount: 0,
    taxAmount: 798,
    totalAmount: 5_000,
  });
  const draft = await service.createDraft(
    draftInput("type-39", lines, {
      source: "automatic_intent_immutable_snapshot",
      amountSnapshot: 5_000,
      netAmount: 4_202,
      exemptAmount: 0,
      taxAmount: 798,
      totalAmount: 5_000,
    }, 39),
    "automatic-worker",
  );
  assert.deepEqual(
    {
      netAmount: draft.netAmount,
      taxAmount: draft.taxAmount,
      totalAmount: draft.totalAmount,
      unitGrossAmount: lines[0].unitGrossAmount,
    },
    {
      netAmount: 4_202,
      taxAmount: 798,
      totalAmount: 5_000,
      unitGrossAmount: 5_000,
    },
  );
  assert.equal(lines[0].pricingMode, "net");
});
