import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import type { ImportedCaf } from "../certification/caf-secure-import";
import {
  InMemoryPrivateDteArtifactStore,
} from "../production/artifact-store";
import { validateProductionConfig } from "../production/config";
import {
  deliverOneRecipientOutbox,
  type RecipientDeliveryOutbox,
} from "../production/delivery";
import type {
  ProductionDteGenerator,
  ProductionGeneratedArtifacts,
} from "../production/generator";
import {
  InMemoryProductionDteRepository,
} from "../production/repository";
import {
  ProductionDteService,
} from "../production/service";
import {
  ProductionSiiClient,
  type ProductionStatusResult,
  type ProductionUploadResult,
} from "../production/sii-client";
import type {
  ProductionArtifact,
  ProductionDteType,
  ProductionTenantSettings,
  RecipientOutboxRecord,
} from "../production/types";

const mockSiiResponse = Buffer.from(
  "<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>1234567890</TRACKID></RECEPCIONDTE>",
);
const mockSiiResponseSha256 = createHash("sha256")
  .update(mockSiiResponse)
  .digest("hex");

const productionEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DTE_PRODUCTION_ENABLED: "true",
  DTE_MODE: "production",
  DTE_SII_ENV: "production",
  DTE_SIGNING_MODE: "production",
  DTE_PRODUCTION_SEED_URL: "https://palena.sii.cl/seed",
  DTE_PRODUCTION_TOKEN_URL: "https://palena.sii.cl/token",
  DTE_PRODUCTION_UPLOAD_URL: "https://palena.sii.cl/upload",
  DTE_PRODUCTION_STATUS_URL: "https://palena.sii.cl/status",
  DTE_PRODUCTION_STORAGE_BUCKET: "dte-production-private",
  DTE_PRODUCTION_CAF_ROOT: "/tmp/citaya-production-caf",
  DTE_PRODUCTION_CERTIFICATE_ROOT: "/tmp/citaya-production-cert",
  DTE_PRODUCTION_PRIVATE_KEY_ROOT: "/tmp/citaya-production-cert",
  DTE_PRODUCTION_TRUST_ANCHOR_IDK: "100",
  DTE_PRODUCTION_TRUST_ANCHOR_PATH: "/tmp/citaya-production-anchor.pem",
  DTE_PRODUCTION_TRUST_ANCHOR_PROVENANCE: "official:test",
  DTE_PRODUCTION_TRUST_ANCHOR_SHA256: "a".repeat(64),
  DTE_PRODUCTION_DATA_KEY: randomBytes(32).toString("base64"),
  DTE_PRODUCTION_TIMEOUT_MS: "30000",
};

function validProductionConfig() {
  const result = validateProductionConfig(productionEnv);
  if (!result.ok) assert.fail("valid config expected");
  return result.config;
}

function settings(tenantId: string, enabled = true): ProductionTenantSettings {
  return {
    tenantId,
    enabled,
    issuer: {
      rut: "78195645-7",
      legalName: "R&G SpA",
      businessActivity: "Servicios digitales",
      businessActivityCode: "620200",
      address: "Regimiento Arica 301",
      commune: "Coquimbo",
      city: "Coquimbo",
      resolutionDate: "2026-07-01",
      resolutionNumber: "80",
      siiOffice: "LA SERENA",
    },
    senderRut: "78195645-7",
    certificatePath: "/tmp/certificate.pem",
    privateKeyPath: "/tmp/private-key.pem",
    certificateValidFrom: "2026-01-01T00:00:00.000Z",
    certificateValidTo: "2030-01-01T00:00:00.000Z",
    autoEmailDelivery: true,
  };
}

function caf(
  tenantId: string,
  dteType: ProductionDteType,
  from: number,
  to: number,
  suffix = "",
) {
  return {
    id: `caf-${tenantId}-${dteType}-${suffix || from}`,
    tenantId,
    dteType,
    issuerRut: "78195645-7",
    rangeFrom: from,
    rangeTo: to,
    authorizationDate: "2026-07-01",
    sha256: `${String(dteType).padStart(2, "0")}${suffix}`.padEnd(64, "a").slice(0, 64),
    logicalIdentity: `${tenantId}${dteType}${suffix}`.padEnd(64, "b").slice(0, 64),
    secureRef: `caf:${tenantId}:${dteType}:${from}`,
    trustStatus: "verified_official" as const,
    active: true,
  };
}

function importedCaf(dteType: ProductionDteType): ImportedCaf {
  return {
    sourcePath: "/tmp/redacted.xml",
    originalBytes: Buffer.from("fixture"),
    originalXml: "fixture",
    cafXml: "<CAF version=\"1.0\"><DA></DA><FRMA algoritmo=\"SHA1withRSA\">AA==</FRMA></CAF>",
    cafBytes: Buffer.from("fixture"),
    daXml: "<DA></DA>",
    daBytes: Buffer.from("<DA></DA>"),
    issuerRut: "78195645-7",
    issuerName: "R&G SpA",
    typeCode: dteType,
    rangeFrom: 1,
    rangeTo: 100,
    authorizationDate: "2026-07-01",
    idk: "100",
    privateKeyPem: "PRIVATE_NOT_LOGGED",
    publicKeyPem: "PUBLIC",
    sha256: "a".repeat(64),
    logicalIdentity: "b".repeat(64),
    materialKind: "production_real",
    trustStatus: "verified_official",
    fixtureKey: false,
    weakLegacyFixture: false,
    realUseBlocked: false,
  };
}

class MockGenerator implements ProductionDteGenerator {
  types: number[] = [];
  async generate(input: {
    document: { dteType: ProductionDteType; id: string };
  }): Promise<ProductionGeneratedArtifacts> {
    this.types.push(input.document.dteType);
    return {
      dteXml: Buffer.from(
        '<?xml version="1.0" encoding="ISO-8859-1"?><DTE xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><FRMT algoritmo="SHA1withRSA">fixture</FRMT><Signature>fixture</Signature></DTE>',
        "latin1",
      ),
      envioXml: Buffer.from(
        '<?xml version="1.0" encoding="ISO-8859-1"?><EnvioDTE xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Signature>fixture</Signature></EnvioDTE>',
        "latin1",
      ),
      pdf: Buffer.from("%PDF-1.4 fixture"),
      metadata: {
        encoding: "ISO-8859-1",
        xsd: "valid",
        xmlsec1: "valid",
        frmt: "valid",
        xmlnsXsiPhysical: true,
      },
    };
  }
}

class MockSiiClient extends ProductionSiiClient {
  uploads = 0;
  statuses = 0;
  constructor(
    private readonly uploadResult: ProductionUploadResult,
    private readonly statusResult: ProductionStatusResult = {
      trackId: "1234567890",
      siiStatus: "accepted",
      responseSha256: "d".repeat(64),
      responseSafe: { category: "manual_status" },
    },
  ) {
    super(validProductionConfig());
  }
  override async uploadExactlyOnce(): Promise<ProductionUploadResult> {
    this.uploads += 1;
    return this.uploadResult;
  }
  override async queryStatusManually(): Promise<ProductionStatusResult> {
    this.statuses += 1;
    return this.statusResult;
  }
}

function draftInput(tenantId: string, dteType: ProductionDteType, suffix: string) {
  return {
    tenantId,
    dteType,
    businessOperationId: `payment:${tenantId}:${suffix}`,
    recipient: {
      rut: "11111111-1",
      legalName: "Cliente Receptor",
      email: "receptor@example.test",
    },
    lines: [{ name: "Servicio", quantity: 2, unitPrice: 10000 }],
    references:
      dteType === 33
        ? []
        : [{ code: "1", reason: "AJUSTE", documentType: "33", folio: "1", date: "2026-07-01", isGlobal: false }],
  };
}

async function preparedService(input: {
  tenantId?: string;
  types?: ProductionDteType[];
  uploadResult?: ProductionUploadResult;
  env?: NodeJS.ProcessEnv;
}) {
  const tenantId = input.tenantId ?? "tenant-a";
  const repository = new InMemoryProductionDteRepository();
  repository.seedTenantSettings(settings(tenantId));
  for (const type of input.types ?? [33])
    await repository.importCaf(caf(tenantId, type, 1, 20));
  const artifactStore = new InMemoryPrivateDteArtifactStore();
  const generator = new MockGenerator();
  const client = new MockSiiClient(
    input.uploadResult ?? {
      status: "submitted",
      trackId: "1234567890",
      responseSha256: mockSiiResponseSha256,
      responseBytes: mockSiiResponse,
      responseSafe: { category: "xml_receipt" },
      uploadCount: 1,
    },
  );
  const service = new ProductionDteService(
    repository,
    artifactStore,
    generator,
    ({ dteType }) => importedCaf(dteType),
    () => client,
    async () => "STATUS_TOKEN_NOT_EXPOSED",
    input.env ?? productionEnv,
    resolve("."),
  );
  return { service, repository, artifactStore, generator, client, tenantId };
}

test("production config is disabled by default and rejects certification URLs", async () => {
  const disabled = validateProductionConfig({ NODE_ENV: "test" });
  assert.equal(disabled.ok, false);
  const certificationUrl = validateProductionConfig({
    ...productionEnv,
    DTE_PRODUCTION_SEED_URL: "https://maullin.sii.cl/seed",
  });
  assert.equal(certificationUrl.ok, false);
  if (!certificationUrl.ok)
    assert.ok(certificationUrl.invalid.includes("DTE_PRODUCTION_SEED_URL"));
  const context = await preparedService({ env: { ...productionEnv, DTE_PRODUCTION_ENABLED: "false" } });
  const draft = await context.service.createDraft(draftInput(context.tenantId, 33, "disabled"), "admin-user");
  await assert.rejects(
    context.service.prepare(context.tenantId, draft.id, "admin-user"),
    /DTE_PRODUCTION_BLOCKED/,
  );
});

test("CAF metadata rejects duplicate, overlap and cross-tenant selection", async () => {
  const repository = new InMemoryProductionDteRepository();
  await repository.importCaf(caf("tenant-a", 33, 1, 10));
  await assert.rejects(
    repository.importCaf(caf("tenant-a", 33, 1, 10)),
    /DTE_CAF_DUPLICATE/,
  );
  await assert.rejects(
    repository.importCaf(caf("tenant-a", 33, 8, 20, "overlap")),
    /DTE_CAF_RANGE_OVERLAP/,
  );
  assert.equal(await repository.selectCaf("tenant-b", 33, 1), null);
});

test("folio reservation is atomic, unique and idempotent under concurrency", async () => {
  const repository = new InMemoryProductionDteRepository();
  await repository.importCaf(caf("tenant-a", 33, 1, 2));
  const [first, second] = await Promise.all([
    repository.reserveFolio({
      tenantId: "tenant-a",
      dteType: 33,
      documentId: "doc-a",
      businessOperationId: "payment:one",
    }),
    repository.reserveFolio({
      tenantId: "tenant-a",
      dteType: 33,
      documentId: "doc-b",
      businessOperationId: "payment:two",
    }),
  ]);
  assert.notEqual(first.folio, second.folio);
  const reused = await repository.reserveFolio({
    tenantId: "tenant-a",
    dteType: 33,
    documentId: "doc-a",
    businessOperationId: "payment:one",
  });
  assert.equal(reused.folio, first.folio);
  assert.equal(reused.reused, true);
});

test("service derives totals and prepares DTE 33, 56 and 61 through certified boundary", async () => {
  const context = await preparedService({ types: [33, 56, 61] });
  for (const type of [33, 56, 61] as const) {
    const draft = await context.service.createDraft(
      draftInput(context.tenantId, type, String(type)),
      "admin-user",
    );
    assert.equal(draft.totalAmount, 23800);
    const ready = await context.service.prepare(
      context.tenantId,
      draft.id,
      "admin-user",
    );
    assert.equal(ready.status, "ready");
    const preflight = await context.service.preflight(
      context.tenantId,
      draft.id,
    );
    assert.equal(preflight.ready, true);
    assert.deepEqual(preflight.artifacts, ["dte_xml", "envio_xml", "pdf"]);
  }
  assert.deepEqual(context.generator.types, [33, 56, 61]);
});

test("tenant isolation protects detail and private downloads", async () => {
  const context = await preparedService({});
  const draft = await context.service.createDraft(
    draftInput(context.tenantId, 33, "isolation"),
    "admin-user",
  );
  await context.service.prepare(context.tenantId, draft.id, "admin-user");
  await assert.rejects(
    context.service.getSafeDetail("tenant-b", draft.id),
    /DTE_DOCUMENT_NOT_FOUND/,
  );
  await assert.rejects(
    context.service.download("tenant-b", draft.id, "pdf"),
    /DTE_DOCUMENT_NOT_FOUND/,
  );
});

test("emit performs one upload, persists Track ID safely and enqueues delivery once", async () => {
  const context = await preparedService({});
  const draft = await context.service.createDraft(
    draftInput(context.tenantId, 33, "submitted"),
    "admin-user",
  );
  await context.service.prepare(context.tenantId, draft.id, "admin-user");
  const submitted = await context.service.emitOnce({
    tenantId: context.tenantId,
    documentId: draft.id,
    confirmation: `EMITIR DTE PRODUCCION ${draft.id}`,
    actorId: "admin-user",
  });
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.hasTrackId, true);
  assert.equal(context.client.uploads, 1);
  assert.equal(context.repository.outboxRecords().length, 0);
  const detail = await context.service.getSafeDetail(context.tenantId, draft.id);
  assert.equal(detail.artifacts.some((artifact) => artifact.kind === "sii_response"), true);
  await assert.rejects(
    context.service.emitOnce({
      tenantId: context.tenantId,
      documentId: draft.id,
      confirmation: `EMITIR DTE PRODUCCION ${draft.id}`,
      actorId: "admin-user",
    }),
    /DTE_EMIT_STATE_INVALID|DTE_UPLOAD_ALREADY_ATTEMPTED/,
  );
  assert.equal(context.client.uploads, 1);
  assert.equal(context.repository.outboxRecords().length, 0);
});

test("SII rejection and ambiguous response are terminal for automatic emission", async () => {
  for (const uploadResult of [
    {
      status: "rejected" as const,
      trackId: null,
      responseSha256: "e".repeat(64),
      responseSafe: { category: "explicit_sii_rejection" },
      uploadCount: 1 as const,
    },
    {
      status: "ambiguous" as const,
      trackId: null,
      responseSha256: null,
      responseSafe: { category: "network_or_timeout" },
      uploadCount: 1 as const,
    },
  ]) {
    const context = await preparedService({ uploadResult });
    const draft = await context.service.createDraft(
      draftInput(context.tenantId, 33, uploadResult.status),
      "admin-user",
    );
    await context.service.prepare(context.tenantId, draft.id, "admin-user");
    const final = await context.service.emitOnce({
      tenantId: context.tenantId,
      documentId: draft.id,
      confirmation: `EMITIR DTE PRODUCCION ${draft.id}`,
      actorId: "admin-user",
    });
    assert.equal(final.status, uploadResult.status);
    assert.equal(context.repository.outboxRecords().length, 0);
    await assert.rejects(
      context.service.emitOnce({
        tenantId: context.tenantId,
        documentId: draft.id,
        confirmation: `EMITIR DTE PRODUCCION ${draft.id}`,
        actorId: "admin-user",
      }),
      /DTE_AMBIGUOUS_RETRY_BLOCKED|DTE_EMIT_STATE_INVALID/,
    );
  }
});

test("manual status recovers a persisted Track ID after an ambiguous process interruption", async () => {
  const context = await preparedService({});
  const draft = await context.service.createDraft(
    draftInput(context.tenantId, 33, "recovery"),
    "admin-user",
  );
  await context.service.prepare(context.tenantId, draft.id, "admin-user");
  const envelope = (await context.repository.listArtifacts(context.tenantId, draft.id))
    .find((artifact) => artifact.kind === "envio_xml");
  assert.ok(envelope);
  await context.repository.createSubmissionAttempt({
    tenantId: context.tenantId,
    documentId: draft.id,
    attemptNumber: 1,
    status: "submitted",
    requestSha256: envelope.sha256,
    responseSha256: mockSiiResponseSha256,
    responseSafe: { category: "receipt_persisted_before_crash" },
    trackId: "1234567890",
    beforeFetchAt: new Date().toISOString(),
    afterFetchAt: new Date().toISOString(),
  });
  await context.repository.transitionDocument({
    tenantId: context.tenantId,
    documentId: draft.id,
    from: ["ready"],
    to: "submitting",
  });
  const result = await context.service.queryStatusManually({
    tenantId: context.tenantId,
    documentId: draft.id,
    actorId: "admin-user",
  });
  assert.equal(result.siiStatus, "accepted");
  assert.equal(context.repository.outboxRecords().length, 1);
  const recovered = await context.service.getSafeDetail(context.tenantId, draft.id);
  assert.equal(recovered.document.status, "submitted");
  assert.equal(recovered.document.hasTrackId, true);
});

test("status is never automatic and only executes through explicit manual action", async () => {
  const context = await preparedService({});
  const draft = await context.service.createDraft(
    draftInput(context.tenantId, 33, "manual-status"),
    "admin-user",
  );
  await context.service.prepare(context.tenantId, draft.id, "admin-user");
  await context.service.emitOnce({
    tenantId: context.tenantId,
    documentId: draft.id,
    confirmation: `EMITIR DTE PRODUCCION ${draft.id}`,
    actorId: "admin-user",
  });
  assert.equal(context.client.statuses, 0);
  const status = await context.service.queryStatusManually({
    tenantId: context.tenantId,
    documentId: draft.id,
    actorId: "admin-user",
  });
  assert.equal(status.siiStatus, "accepted");
  assert.equal(context.client.statuses, 1);
});

test("production SII client performs seed, token and exactly one upload with mocks", async () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-prod-sii-"));
  try {
    const keyPath = join(root, "key.pem");
    const certPath = join(root, "cert.pem");
    const openssl = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=Citaya Test",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
      ],
      { stdio: "ignore" },
    );
    assert.equal(openssl.status, 0);
    let calls = 0;
    let uploads = 0;
    let statusCalls = 0;
    const fetchMock: typeof fetch = async (url) => {
      calls += 1;
      const target = String(url);
      if (target.endsWith("/status")) statusCalls += 1;
      if (target.endsWith("/seed"))
        return new Response(
          "<RESPUESTA><RESP_BODY><SEMILLA>123456</SEMILLA><ESTADO>00</ESTADO></RESP_BODY></RESPUESTA>",
        );
      if (target.endsWith("/token"))
        return new Response(
          "<RESPUESTA><RESP_BODY><TOKEN>token-mock</TOKEN><ESTADO>00</ESTADO></RESP_BODY></RESPUESTA>",
        );
      uploads += 1;
      return new Response(
        "<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>1234567890</TRACKID></RECEPCIONDTE>",
        { status: 200, headers: { "content-type": "text/xml" } },
      );
    };
    const config = validateProductionConfig(productionEnv);
    assert.equal(config.ok, true);
    if (!config.ok) return;
    const client = new ProductionSiiClient({ ...config.config, certificateRoot: root, privateKeyRoot: root }, fetchMock);
    const milestones: string[] = [];
    const result = await client.uploadExactlyOnce({
      envelope: Buffer.from("<EnvioDTE/>"),
      fileName: "33-1.xml",
      issuerRut: "78195645-7",
      senderRut: "78195645-7",
      certificatePath: certPath,
      privateKeyPath: keyPath,
      milestone: async (event) => {
        milestones.push(event);
      },
    });
    assert.equal(result.status, "submitted");
    assert.equal(result.uploadCount, 1);
    assert.equal(uploads, 1);
    assert.equal(calls, 3);
    assert.equal(statusCalls, 0);
    assert.deepEqual(milestones, [
      "seed_before_fetch",
      "seed_after_fetch",
      "token_before_fetch",
      "token_after_fetch",
      "upload_before_fetch",
      "upload_after_fetch",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("upload timeout becomes ambiguous and is not retried", async () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-prod-timeout-"));
  try {
    const key = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const keyPath = join(root, "key.pem");
    const certPath = join(root, "cert.pem");
    writeFileSync(keyPath, key.privateKey);
    chmodSync(keyPath, 0o600);
    const openssl = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-new",
        "-key",
        keyPath,
        "-subj",
        "/CN=Citaya Timeout",
        "-out",
        certPath,
        "-days",
        "1",
      ],
      { stdio: "ignore" },
    );
    assert.equal(openssl.status, 0);
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      if (calls === 1)
        return new Response(
          "<RESPUESTA><RESP_BODY><SEMILLA>123</SEMILLA><ESTADO>00</ESTADO></RESP_BODY></RESPUESTA>",
        );
      if (calls === 2)
        return new Response(
          "<RESPUESTA><RESP_BODY><TOKEN>token</TOKEN><ESTADO>00</ESTADO></RESP_BODY></RESPUESTA>",
        );
      throw new DOMException("timeout", "TimeoutError");
    };
    const config = validateProductionConfig(productionEnv);
    assert.equal(config.ok, true);
    if (!config.ok) return;
    const result = await new ProductionSiiClient(
      { ...config.config, certificateRoot: root, privateKeyRoot: root },
      fetchMock,
    ).uploadExactlyOnce({
      envelope: Buffer.from("<EnvioDTE/>"),
      fileName: "33-1.xml",
      issuerRut: "78195645-7",
      senderRut: "78195645-7",
      certificatePath: certPath,
      privateKeyPath: keyPath,
      milestone: async () => {},
    });
    assert.equal(result.status, "ambiguous");
    assert.equal(result.uploadCount, 1);
    assert.equal(calls, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recipient outbox delivery is idempotent and uses no real email transport", async () => {
  const artifacts = new InMemoryPrivateDteArtifactStore();
  const xmlWrite = await artifacts.putImmutable({
    tenantId: "tenant-a",
    documentId: "document-a",
    fileName: "33-1.xml",
    contentType: "text/xml",
    bytes: Buffer.from("<DTE/>"),
  });
  const pdfWrite = await artifacts.putImmutable({
    tenantId: "tenant-a",
    documentId: "document-a",
    fileName: "33-1.pdf",
    contentType: "application/pdf",
    bytes: Buffer.from("%PDF"),
  });
  const metadata = (id: string, kind: "dte_xml" | "pdf", value: typeof xmlWrite): ProductionArtifact => ({
    id,
    tenantId: "tenant-a",
    documentId: "document-a",
    kind,
    storageKey: value.storageKey,
    sha256: value.sha256,
    byteLength: value.byteLength,
    contentType: kind === "pdf" ? "application/pdf" : "text/xml",
    immutable: true,
    createdAt: new Date().toISOString(),
  });
  const record: RecipientOutboxRecord = {
    id: "outbox-a",
    tenantId: "tenant-a",
    documentId: "document-a",
    recipientEmail: "receptor@example.test",
    idempotencyKey: "recipient:document-a",
    status: "delivering",
    xmlArtifactId: "xml-a",
    pdfArtifactId: "pdf-a",
    attempts: 1,
    createdAt: new Date().toISOString(),
    deliveredAt: null,
  };
  let claimed = false;
  let delivered = false;
  const outbox: RecipientDeliveryOutbox = {
    claimNext: async () => {
      if (claimed) return null;
      claimed = true;
      return record;
    },
    markDelivered: async () => {
      delivered = true;
    },
    markFailed: async () => assert.fail("delivery should not fail"),
    getArtifact: async (id) =>
      id === "xml-a"
        ? metadata("xml-a", "dte_xml", xmlWrite)
        : metadata("pdf-a", "pdf", pdfWrite),
  };
  let sends = 0;
  const transport = {
    send: async (input: { idempotencyKey: string }) => {
      sends += 1;
      assert.equal(input.idempotencyKey, "recipient:document-a");
    },
  };
  assert.equal(
    await deliverOneRecipientOutbox({ outbox, artifacts, transport }),
    "delivered",
  );
  assert.equal(
    await deliverOneRecipientOutbox({ outbox, artifacts, transport }),
    "empty",
  );
  assert.equal(sends, 1);
  assert.equal(delivered, true);
});

test("all production admin routes enforce tenant admin authorization", async () => {
  const routeFiles = [
    "app/api/admin/dte-production/drafts/route.ts",
    "app/api/admin/dte-production/caf/import/route.ts",
    "app/api/admin/dte-production/[id]/prepare/route.ts",
    "app/api/admin/dte-production/[id]/preflight/route.ts",
    "app/api/admin/dte-production/[id]/emit/route.ts",
    "app/api/admin/dte-production/[id]/status/route.ts",
    "app/api/admin/dte-production/[id]/route.ts",
    "app/api/admin/dte-production/[id]/artifacts/[kind]/route.ts",
  ];
  const { readFileSync } = await import("node:fs");
  for (const file of routeFiles) {
    const source = readFileSync(resolve(file), "utf8");
    assert.match(source, /requireProductionAdmin/);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|PRIVATE_KEY|TRACKID/);
  }
});
