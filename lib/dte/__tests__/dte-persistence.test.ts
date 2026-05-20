import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildAuditRecord } from "../persistence/dte-audit";
import { sha256String } from "../persistence/dte-hash";
import {
  fingerprintToken,
  redactSensitivePath,
  redactSiiResponse,
  redactToken,
  safeJsonForAudit,
} from "../persistence/dte-redaction";
import {
  getDtePersistenceBackend,
  getDteRepository,
} from "../persistence/get-dte-repository";
import { InMemoryDteRepository } from "../persistence/dte-repository";
import {
  DTE_SUPABASE_PERSISTENCE_NOT_READY,
  SupabaseDteRepository,
} from "../persistence/supabase-dte-repository";
import { buildStatusHistoryRecord } from "../persistence/dte-status-history";
import { buildSubmissionRecord } from "../persistence/dte-submissions";
import {
  buildSmokeDocumentIdentity,
  getSmokeTenantId,
  writeSmokeTrace,
} from "../persistence/dte-smoke-trace";
import type { DteRepository } from "../persistence/dte-repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("hashes strings with stable SHA-256", () => {
  assert.equal(
    sha256String("citaya"),
    "6d1114b745bde27a002aff4b606507306016a9d9d16da5a724cf5e5cfede20f1",
  );
});

test("redacts and fingerprints tokens without storing full token", () => {
  const token = "1234567890abcdef";

  assert.equal(redactToken(token), "1234...cdef");
  assert.notEqual(fingerprintToken(token), token);
  assert.equal(fingerprintToken(token)?.length, 64);
});

test("redacts SII responses and sensitive audit metadata", () => {
  const redacted = redactSiiResponse({
    TRACKID: "123",
    ESTADO: "REC",
    TOKEN: "secret-token",
  });

  assert.equal(redacted.trackId, "123");
  assert.equal(redacted.status, "REC");
  assert.equal(redacted.redacted, true);

  const safe = safeJsonForAudit({
    token: "secret",
    privateKey: "-----BEGIN PRIVATE KEY-----",
    nested: { password: "hidden" },
  });
  assert.equal(safe.token, "[redacted]");
  assert.deepEqual(safe.nested, { password: "[redacted]" });
  assert.match(redactSensitivePath("/secure/citaya/private-key.pem") ?? "", /private-key\.pem/);
});

test("builds status history with valid transitions", () => {
  const history = buildStatusHistoryRecord({
    tenantId: "tenant-1",
    taxDocumentId: "doc-1",
    previousStatus: "draft",
    nextStatus: "xml_generated",
    previousSiiStatus: "not_sent",
    nextSiiStatus: "not_sent",
    reason: "xml generated",
    source: "script",
  });

  assert.equal(history.nextStatus, "xml_generated");
  assert.throws(() =>
    buildStatusHistoryRecord({
      tenantId: "tenant-1",
      taxDocumentId: "doc-1",
      previousStatus: "draft",
      nextStatus: "accepted",
      previousSiiStatus: "not_sent",
      nextSiiStatus: "accepted",
      reason: "bad jump",
      source: "script",
    }),
  );
});

test("builders generate UUID-compatible ids for Supabase persistence", () => {
  const submission = buildSubmissionRecord({
    tenantId: "tenant-1",
    taxDocumentId: "doc-1",
    environment: "certification",
    submissionStatus: "dry_run",
    siiStatus: "not_sent",
  });
  const history = buildStatusHistoryRecord({
    tenantId: "tenant-1",
    taxDocumentId: "doc-1",
    previousStatus: "draft",
    nextStatus: "xml_generated",
    previousSiiStatus: "not_sent",
    nextSiiStatus: "not_sent",
    reason: "xml generated",
    source: "script",
  });
  const audit = buildAuditRecord({
    tenantId: "tenant-1",
    taxDocumentId: "doc-1",
    action: "sii_dry_run_trace",
    actorType: "script",
  });

  assert.match(submission.id, UUID_RE);
  assert.match(history.id, UUID_RE);
  assert.match(audit.id, UUID_RE);
});

test("builders preserve explicit ids for compatibility", () => {
  assert.equal(
    buildSubmissionRecord({
      id: "00000000-0000-4000-8000-000000000001",
      tenantId: "tenant-1",
      taxDocumentId: "doc-1",
      environment: "certification",
      submissionStatus: "dry_run",
      siiStatus: "not_sent",
    }).id,
    "00000000-0000-4000-8000-000000000001",
  );

  assert.equal(
    buildStatusHistoryRecord({
      id: "00000000-0000-4000-8000-000000000002",
      tenantId: "tenant-1",
      taxDocumentId: "doc-1",
      previousStatus: "draft",
      nextStatus: "xml_generated",
      previousSiiStatus: "not_sent",
      nextSiiStatus: "not_sent",
      reason: "xml generated",
      source: "script",
    }).id,
    "00000000-0000-4000-8000-000000000002",
  );

  assert.equal(
    buildAuditRecord({
      id: "00000000-0000-4000-8000-000000000003",
      tenantId: "tenant-1",
      action: "sii_dry_run_trace",
      actorType: "script",
    }).id,
    "00000000-0000-4000-8000-000000000003",
  );
});

test("in-memory repository records document, submission, status history and audit", async () => {
  const repo = new InMemoryDteRepository();
  const draft = await repo.createTaxDocumentDraft({
    tenantId: "tenant-1",
    documentType: "factura_afecta",
    folio: 1001,
    emitterRut: "76.123.456-0",
    emitterName: "Emisor Demo",
    receiverRut: "11.111.111-1",
    receiverName: "Cliente Demo",
    issueDate: "2026-05-15",
    totalAmount: 11900,
    netAmount: 10000,
    taxAmount: 1900,
    exemptAmount: 0,
    paymentReference: "pay-1",
  });

  assert.equal(draft.ok, true);
  if (!draft.ok) return;

  const xml = "<EnvioDTE>LAB</EnvioDTE>";
  const xmlGenerated = await repo.markXmlGenerated({
    tenantId: draft.record.tenantId,
    taxDocumentId: draft.record.id,
    xml,
  });
  assert.equal(xmlGenerated.ok, true);
  if (!xmlGenerated.ok) return;
  assert.equal(xmlGenerated.record.xmlSha256, sha256String(xml));

  const submission = buildSubmissionRecord({
    tenantId: draft.record.tenantId,
    taxDocumentId: draft.record.id,
    environment: "certification",
    submissionStatus: "blocked",
    siiStatus: "not_sent",
    requestXml: xml,
    token: "secret-token",
    response: { status: "blocked", token: "secret-token" },
  });
  const savedSubmission = await repo.createSiiSubmission(submission);
  assert.equal(savedSubmission.ok, true);
  assert.notEqual(submission.tokenFingerprint, "secret-token");

  const audit = buildAuditRecord({
    tenantId: draft.record.tenantId,
    taxDocumentId: draft.record.id,
    submissionId: submission.id,
    action: "sii_submit_blocked",
    actorType: "script",
    metadata: { token: "secret-token" },
  });
  await repo.appendAuditLog(audit);
  assert.equal(repo.auditLog[0].metadataRedacted.token, "[redacted]");

  assert.equal(
    (await repo.findByDocumentReference({
      tenantId: "tenant-1",
      paymentReference: "pay-1",
    }))?.id,
    draft.record.id,
  );

  const recent = await repo.listRecentByTenant({ tenantId: "tenant-1", limit: 5 });
  const submissions = await repo.listSubmissionsByTenant({
    tenantId: "tenant-1",
    environment: "certification",
  });
  const auditLog = await repo.listAuditLogByTenant({ tenantId: "tenant-1" });

  assert.equal(recent.length, 1);
  assert.equal(submissions.length, 1);
  assert.equal(auditLog.length, 1);
});

test("repository factory defaults to memory unless Supabase flag is explicit", () => {
  assert.equal(getDtePersistenceBackend({}), "memory");
  assert.equal(getDtePersistenceBackend({ DTE_PERSISTENCE_BACKEND: "memory" }), "memory");
  assert.equal(getDtePersistenceBackend({ DTE_PERSISTENCE_BACKEND: "disabled" }), "memory");
  assert.equal(getDtePersistenceBackend({ DTE_PERSISTENCE_BACKEND: "supabase" }), "supabase");
  assert.ok(getDteRepository({}) instanceof InMemoryDteRepository);
});

test("repositories reject missing tenant_id before persistence operations", async () => {
  const draft = {
    tenantId: "",
    documentType: "factura_afecta" as const,
    folio: 1001,
    emitterRut: "76.123.456-0",
    emitterName: "Emisor Demo",
    receiverRut: "11.111.111-1",
    receiverName: "Cliente Demo",
    issueDate: "2026-05-15",
    totalAmount: 11900,
    paymentReference: "missing-tenant",
  };

  const memory = new InMemoryDteRepository();
  const memoryResult = await memory.createTaxDocumentDraft(draft);
  assert.equal(memoryResult.ok, false);

  const supabase = new SupabaseDteRepository({} as never);
  const supabaseResult = await supabase.createTaxDocumentDraft(draft);
  assert.equal(supabaseResult.ok, false);
  if (!supabaseResult.ok) assert.match(supabaseResult.error, /tenantId requerido/);
});

test("repository update and track lookup require matching tenant_id", async () => {
  const repo = new InMemoryDteRepository();
  const draft = await repo.createTaxDocumentDraft({
    tenantId: "tenant-a",
    documentType: "factura_afecta",
    folio: 2001,
    emitterRut: "76.123.456-0",
    emitterName: "Emisor Demo",
    receiverRut: "11.111.111-1",
    receiverName: "Cliente Demo",
    issueDate: "2026-05-15",
    totalAmount: 11900,
  });
  assert.equal(draft.ok, true);
  if (!draft.ok) return;

  const crossTenantUpdate = await repo.markXmlGenerated({
    tenantId: "tenant-b",
    taxDocumentId: draft.record.id,
    xml: "<DTE />",
  });
  assert.equal(crossTenantUpdate.ok, false);

  const submission = buildSubmissionRecord({
    tenantId: "tenant-a",
    taxDocumentId: draft.record.id,
    environment: "certification",
    trackId: "track-tenant-a",
    submissionStatus: "submitted",
    siiStatus: "sent",
  });
  await repo.createSiiSubmission(submission);

  assert.equal(await repo.findByTrackId({ tenantId: "tenant-b", trackId: "track-tenant-a" }), null);
  assert.equal(
    (await repo.findByTrackId({ tenantId: "tenant-a", trackId: "track-tenant-a" }))?.id,
    submission.id,
  );
});

test("SupabaseDteRepository fails controlled when env is not configured", () => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    assert.throws(
      () => new SupabaseDteRepository(),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(DTE_SUPABASE_PERSISTENCE_NOT_READY),
    );
  } finally {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test("redaction helpers keep admin trace payloads free of secrets and private paths", () => {
  const safePath = redactSensitivePath("/vault/tenant/private/certification-token.xml");
  assert.ok(safePath?.includes("certification-token.xml"));
  assert.ok(!safePath?.includes("/vault/tenant/private"));

  const audit = safeJsonForAudit({
    token: "full-token",
    authorization: "Bearer full-token",
  });
  assert.equal(audit.token, "[redacted]");
  assert.equal(audit.authorization, "[redacted]");
});

test("smoke trace requires a real tenant id when Supabase backend is active", () => {
  assert.throws(
    () => getSmokeTenantId("supabase", {}),
    /DTE_SMOKE_TENANT_ID_REQUIRED_FOR_SUPABASE/,
  );

  assert.equal(
    getSmokeTenantId("supabase", {
      DTE_SMOKE_TENANT_ID: "84ce60a0-1eb0-426b-adbc-c9cfbc76807c",
    }),
    "84ce60a0-1eb0-426b-adbc-c9cfbc76807c",
  );
  assert.equal(getSmokeTenantId("memory", {}), "tenant-smoke-lab");
});

test("smoke trace generates repeatable-safe Supabase folio and reference", () => {
  const first = buildSmokeDocumentIdentity("supabase", {}, 1_717_000_000_000, 1_001);
  const second = buildSmokeDocumentIdentity("supabase", {}, 1_717_000_000_001, 1_002);

  assert.notEqual(first.folio, second.folio);
  assert.match(first.paymentReference, /^smoke-dry-run-\d+-1717000000000-1001$/);
  assert.deepEqual(buildSmokeDocumentIdentity("memory", {}, 1, 1), {
    folio: 1001,
    paymentReference: "smoke-dry-run",
  });
  assert.equal(
    buildSmokeDocumentIdentity(
      "supabase",
      { DTE_SMOKE_FOLIO: "7777" },
      1_717_000_000_000,
      1_001,
    ).folio,
    7777,
  );
});

test("smoke trace fails when repository side effects fail", async () => {
  for (const failingMethod of [
    "createSiiSubmission",
    "appendStatusHistory",
    "appendAuditLog",
  ] as const) {
    const repo = buildFailingSmokeRepository(failingMethod);

    await assert.rejects(
      () =>
        writeSmokeTrace({
          repoRoot: process.cwd(),
          outputPath: resolve(process.cwd(), `tmp/dte-certification/${failingMethod}.json`),
          dryRun: true,
          configSummary: {},
          steps: [],
          repository: repo,
          backend: "memory",
        }),
      new RegExp(`${failingMethod} failed`),
    );
  }
});

function buildFailingSmokeRepository(
  failingMethod: "createSiiSubmission" | "appendStatusHistory" | "appendAuditLog",
): DteRepository {
  const repo = new InMemoryDteRepository();
  const failure = { ok: false as const, error: `${failingMethod} failed` };

  return {
    ...repo,
    createTaxDocumentDraft: repo.createTaxDocumentDraft.bind(repo),
    markXmlGenerated: repo.markXmlGenerated.bind(repo),
    markSigned: repo.markSigned.bind(repo),
    updateSiiSubmissionStatus: repo.updateSiiSubmissionStatus.bind(repo),
    findByTrackId: repo.findByTrackId.bind(repo),
    findTaxDocumentById: repo.findTaxDocumentById.bind(repo),
    findByDocumentReference: repo.findByDocumentReference.bind(repo),
    findByTenantAndFolio: repo.findByTenantAndFolio.bind(repo),
    listRecentByTenant: repo.listRecentByTenant.bind(repo),
    listSubmissionsByTenant: repo.listSubmissionsByTenant.bind(repo),
    listAuditLogByTenant: repo.listAuditLogByTenant.bind(repo),
    createSiiSubmission:
      failingMethod === "createSiiSubmission"
        ? async () => failure
        : repo.createSiiSubmission.bind(repo),
    appendStatusHistory:
      failingMethod === "appendStatusHistory"
        ? async () => failure
        : repo.appendStatusHistory.bind(repo),
    appendAuditLog:
      failingMethod === "appendAuditLog"
        ? async () => failure
        : repo.appendAuditLog.bind(repo),
  };
}

test("smoke dry-run writes safe trace summary", async () => {
  const tracePath = resolve(
    process.cwd(),
    "tmp/dte-certification/smoke-submission-log.json",
  );
  if (existsSync(tracePath)) {
    await rm(tracePath);
  }

  const result = spawnSync(
    "node",
    ["scripts/dte/sii-certification-smoke.mjs", "--dry-run"],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.equal(existsSync(tracePath), true);

  const trace = JSON.parse(readFileSync(tracePath, "utf8")) as Record<string, unknown>;
  assert.equal(trace.environment, "certification");
  assert.equal(trace.dryRun, true);
  assert.equal(trace.trackId, null);
  assert.equal(trace.siiStatus, "not_sent");
});
