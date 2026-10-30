import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { chileIssueDate } from "../chile-issue-date";
import { validateInvoiceDraftReferences } from "../invoice-drafts";
import type { TaxDocumentDraft } from "../types";
import { buildDteDocumentoXmlLab } from "../xml/build-dte-envelope";

const oc = { documentType: "801", folio: "OC-TEST-123", date: "2026-04-20" };
const base: TaxDocumentDraft = {
  tenantId: "tenant-lab-oc",
  issueMode: "citaya_own_dte",
  documentType: "factura_afecta",
  status: "draft",
  folio: 100,
  issueDate: "2026-05-01",
  issuer: {
    tenantId: "tenant-lab-oc",
    rut: "12.345.678-5",
    legalName: "Emisor Test SpA",
    businessActivity: "Servicios de prueba",
    activityCode: "620200",
    address: "Dirección 1",
    commune: "Santiago",
    city: "Santiago",
    dteEnvironment: "lab",
  },
  recipient: {
    rut: "11.111.111-1",
    legalName: "Cliente Test SpA",
    businessActivity: "Servicios",
    address: "Dirección 2",
    commune: "Providencia",
    city: "Santiago",
  },
  lines: [{ name: "Servicio de prueba", quantity: 1, unitPrice: 10000, amount: 10000 }],
  netAmount: 10000,
  taxAmount: 1900,
  totalAmount: 11900,
};

test("Factura 33: valid OC 801 is canonical, optional, and has no CodRef", () => {
  assert.deepEqual(validateInvoiceDraftReferences(undefined, 33), []);
  assert.deepEqual(validateInvoiceDraftReferences([], 33), []);
  const references = validateInvoiceDraftReferences([oc], 33);
  assert.deepEqual(references, [{ ...oc, reason: "Orden de compra", code: "" }]);
  const xml = buildDteDocumentoXmlLab({ ...base, references });
  assert.match(xml, /<TipoDTE>33<\/TipoDTE>/);
  assert.match(xml, /<FchEmis>2026-05-01<\/FchEmis>/);
  assert.match(xml, /<Referencia>\s*<NroLinRef>1<\/NroLinRef>\s*<TpoDocRef>801<\/TpoDocRef>\s*<FolioRef>OC-TEST-123<\/FolioRef>\s*<FchRef>2026-04-20<\/FchRef>\s*<RazonRef>Orden de compra<\/RazonRef>\s*<\/Referencia>/);
  assert.doesNotMatch(xml, /<CodRef>/);
});

test("Factura without OC remains unchanged; note 61 retains CodRef=3", () => {
  const without = buildDteDocumentoXmlLab(base);
  assert.doesNotMatch(without, /<Referencia>/);
  const creditNote = buildDteDocumentoXmlLab({
    ...base,
    documentType: "nota_credito",
    references: [{ documentType: "33", folio: "55", date: "2026-04-20", code: "3", reason: "Corrige glosa" }],
  });
  assert.match(creditNote, /<TpoDocRef>33<\/TpoDocRef>/);
  assert.match(creditNote, /<CodRef>3<\/CodRef>/);
});

test("rejects malformed purchase order, CodRef injection, invalid date, and boleta 39", () => {
  for (const invalid of [
    [{ ...oc, date: "2026-02-30" }],
    [{ ...oc, date: "2026-13-10" }],
    [{ ...oc, code: "3" }],
    [{ ...oc, documentType: "33" }],
    [{ ...oc, folio: "" }],
    [{ ...oc, folio: "a".repeat(19) }],
    [{ ...oc, extra: "unsafe" }],
    [oc, oc],
    "invalid",
  ]) {
    assert.throws(() => validateInvoiceDraftReferences(invalid, 33), /DTE_INVOICE_REFERENCE/);
  }
  assert.throws(() => validateInvoiceDraftReferences([oc], 39), /DTE_INVOICE_REFERENCES_NOT_ALLOWED/);
});

test("issued date follows Chile at issuance instant, never the referenced OC date", () => {
  assert.equal(chileIssueDate(new Date("2026-10-31T02:00:00.000Z")), "2026-10-30");
  assert.equal(chileIssueDate(new Date("2026-10-31T04:00:00.000Z")), "2026-10-31");
});

test("persistence and immutable snapshot wiring are tenant-scoped (source regression)", () => {
  const create = readFileSync("app/api/admin/invoice-drafts/route.ts", "utf8");
  const edit = readFileSync("app/api/admin/invoice-drafts/[id]/route.ts", "utf8");
  const worker = readFileSync("lib/dte/automation/worker.ts", "utf8");
  const migration = readFileSync("migrations/202610300001_cit143_invoice_oc_references.sql", "utf8");
  const ui = readFileSync("components/admin/dte/ManualIssuanceForm.tsx", "utf8");
  assert.match(create, /document_references: documentReferences/);
  assert.match(create, /document_references,intent_id/);
  assert.match(edit, /document_references: documentReferences/);
  assert.match(edit, /current\.document_references/);
  assert.match(create, /\.eq\("tenant_id", auth\.tenantId\)/);
  assert.match(edit, /\.eq\("tenant_id", auth\.tenantId\)/);
  assert.match(migration, /'references', draft_row\.document_references/);
  assert.match(migration, /where tenant_id = p_tenant_id and id = p_draft_id for update/);
  assert.match(worker, /validateInvoiceDraftReferences\(immutable\.references \?\? \[\], 33\)/);
  assert.match(worker, /if \(\[56, 61\]\.includes\(dteType\)\)/);
  assert.match(ui, /setPurchaseOrderFolio\(oc\?\.folio \?\? ""\)/);
  assert.match(ui, /hasUnsavedChanges/);
  assert.match(ui, /Confirmar emisión REAL de factura/);
});
