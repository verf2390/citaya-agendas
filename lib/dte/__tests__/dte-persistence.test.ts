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
import { InMemoryDteRepository } from "../persistence/dte-repository";
import { buildStatusHistoryRecord } from "../persistence/dte-status-history";
import { buildSubmissionRecord } from "../persistence/dte-submissions";

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
});

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
