import assert from "node:assert/strict";
import test from "node:test";

import { buildBoletaXml } from "../xml/build-boleta";
import type { TaxDocumentDraft } from "../types";

const draft: TaxDocumentDraft = {
  tenantId: "tenant-lab",
  issueMode: "citaya_own_dte",
  documentType: "boleta_afecta",
  status: "draft",
  folio: 123,
  issueDate: "2026-05-08",
  issuer: {
    tenantId: "tenant-lab",
    rut: "12.345.678-5",
    legalName: "Citaya Tenant Lab SpA",
    businessActivity: "Servicios de agenda",
    address: "Av. Prueba 123",
    commune: "Santiago",
    city: "Santiago",
    dteEnvironment: "certification",
  },
  recipient: {
    rut: "11.111.111-1",
    legalName: "Cliente Laboratorio",
  },
  lines: [
    {
      name: "Reserva de prueba",
      quantity: 1,
      unitPrice: 11900,
      amount: 11900,
    },
  ],
  netAmount: 10000,
  taxAmount: 1900,
  totalAmount: 11900,
};

test("generates lab XML with minimum DTE fields", () => {
  const result = buildBoletaXml(draft);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.match(result.xml, /NO PRODUCTIVO/);
  assert.match(result.xml, /<TipoDTE>39<\/TipoDTE>/);
  assert.match(result.xml, /<Folio>123<\/Folio>/);
  assert.match(result.xml, /<RUTEmisor>12345678-5<\/RUTEmisor>/);
  assert.match(result.xml, /<RUTRecep>11111111-1<\/RUTRecep>/);
  assert.match(result.xml, /<MntTotal>11900<\/MntTotal>/);
});
