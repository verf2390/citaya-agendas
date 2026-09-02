import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoletaPdfGrant,
  matchesPublicBoletaVerification,
  verifyBoletaPdfGrant,
} from "../public-boleta-verification";
import { normalizeRut } from "../rut";
import { resolveTenantOperationalCapabilities } from "../../tenant/operational-mode.mjs";

const lookup = {
  documentType: 39 as const,
  folio: 40_015,
  issueDate: "2026-08-10",
  totalAmount: 5_000,
};

const acceptedDocument = {
  dte_type: 39,
  folio: 40_015,
  issue_date: "2026-08-10",
  total_amount: 5_000,
  sii_status: "accepted",
};

test("CIT-38 canonicalizes formatted and unformatted issuer RUTs exactly", () => {
  assert.equal(normalizeRut("78.195.645-7"), "78195645-7");
  assert.equal(normalizeRut("78195645-7"), "78195645-7");
  assert.notEqual(normalizeRut("12.345.678-5"), "78195645-7");
});

test("CIT-38 matches only the exact type 39 fiscal snapshot", () => {
  assert.equal(matchesPublicBoletaVerification(lookup, acceptedDocument), true);
  assert.equal(
    matchesPublicBoletaVerification(lookup, { ...acceptedDocument, dte_type: 33 }),
    false,
  );
  assert.equal(
    matchesPublicBoletaVerification(lookup, { ...acceptedDocument, folio: 40_016 }),
    false,
  );
  assert.equal(
    matchesPublicBoletaVerification(lookup, { ...acceptedDocument, issue_date: "2026-08-11" }),
    false,
  );
  assert.equal(
    matchesPublicBoletaVerification(lookup, { ...acceptedDocument, total_amount: 5_001 }),
    false,
  );
});

test("CIT-38 accepts only the existing deliverable SII status policy", () => {
  for (const siiStatus of ["accepted", "accepted_with_objections", "epr", "eok"]) {
    assert.equal(
      matchesPublicBoletaVerification(lookup, { ...acceptedDocument, sii_status: siiStatus }),
      true,
      siiStatus,
    );
  }
  for (const siiStatus of [null, "submitted", "processing", "rejected", "ambiguous"]) {
    assert.equal(
      matchesPublicBoletaVerification(lookup, { ...acceptedDocument, sii_status: siiStatus }),
      false,
      String(siiStatus),
    );
  }
});

test("CIT-38 lets fiscal state verify an accepted document without widening internal mode", () => {
  const internal = resolveTenantOperationalCapabilities({
    lifecycleStatus: "active",
    operationalMode: "internal",
  });

  assert.equal(internal.publicTaxDocument, false);
  assert.equal(internal.createPayment, false);
  assert.equal(internal.acceptPaymentWebhook, false);
  assert.equal(internal.sendExternalEmail, false);
  assert.equal(internal.sendCampaign, false);
  assert.equal(internal.enqueueDte, false);
  assert.equal(internal.runDteWorker, false);
  assert.equal(matchesPublicBoletaVerification(lookup, acceptedDocument), true);
});

test("CIT-38 preserves the signed five-minute PDF grant", () => {
  const previousSecret = process.env.CITAYA_MANAGE_TOKEN_PEPPER;
  const previousNow = Date.now;
  process.env.CITAYA_MANAGE_TOKEN_PEPPER = "cit38-test-secret-that-is-at-least-32-bytes";
  Date.now = () => 1_000_000;
  try {
    const grant = createBoletaPdfGrant({
      tenantId: "tenant-internal",
      documentId: "document-accepted-39",
    });
    assert.deepEqual(verifyBoletaPdfGrant(grant), {
      tenantId: "tenant-internal",
      documentId: "document-accepted-39",
      expiresAt: 1_300_000,
    });
    Date.now = () => 1_300_001;
    assert.equal(verifyBoletaPdfGrant(grant), null);
  } finally {
    Date.now = previousNow;
    if (previousSecret === undefined) delete process.env.CITAYA_MANAGE_TOKEN_PEPPER;
    else process.env.CITAYA_MANAGE_TOKEN_PEPPER = previousSecret;
  }
});
