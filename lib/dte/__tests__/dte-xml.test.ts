import assert from "node:assert/strict";
import test from "node:test";

import { buildBoletaXmlLab } from "../xml/build-boleta";
import { buildFacturaXmlLab } from "../xml/build-factura";
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
    businessActivity: "Servicios personales",
    address: "Calle Cliente 456",
    commune: "Providencia",
    city: "Santiago",
    email: "cliente@example.test",
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

test("generates boleta lab XML with SII-like DTE fields", () => {
  const result = buildBoletaXmlLab(draft);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.match(result.xml, /NO PRODUCTIVO/);
  assert.match(result.xml, /SII-like XML laboratory format/);
  assert.match(result.xml, /<EnvioDTE/);
  assert.match(result.xml, /<SetDTE/);
  assert.match(result.xml, /<Caratula/);
  assert.match(result.xml, /<DTE version="1.0">/);
  assert.match(result.xml, /<Documento ID="CitayaDocLab-39-123">/);
  assert.match(result.xml, /<Encabezado>/);
  assert.match(result.xml, /<TipoDTE>39<\/TipoDTE>/);
  assert.match(result.xml, /<Folio>123<\/Folio>/);
  assert.match(result.xml, /<RUTEmisor>12345678-5<\/RUTEmisor>/);
  assert.match(result.xml, /<RUTRecep>11111111-1<\/RUTRecep>/);
  assert.match(result.xml, /<MntTotal>11900<\/MntTotal>/);
  assert.match(result.xml, /<Detalle>/);
  assert.match(result.xml, /<NmbItem>Reserva de prueba<\/NmbItem>/);
});

test("generates factura lab XML with expected document type", () => {
  const result = buildFacturaXmlLab({
    ...draft,
    documentType: "factura_afecta",
    folio: 456,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.match(result.xml, /<TipoDTE>33<\/TipoDTE>/);
  assert.match(result.xml, /<Folio>456<\/Folio>/);
  assert.match(result.xml, /<Emisor>/);
  assert.match(result.xml, /<Receptor>/);
  assert.match(result.xml, /<Totales>/);
});

test("escapes XML special characters in text fields", () => {
  const result = buildBoletaXmlLab({
    ...draft,
    issuer: {
      ...draft.issuer,
      legalName: "Tenant & Agenda <Lab> \"Uno\" 'Dos'",
    },
    recipient: {
      ...draft.recipient,
      legalName: "Cliente & Prueba <QA>",
    },
    lines: [
      {
        name: "Servicio & test <premium>",
        description: "Incluye \"agenda\" y 'recordatorio'",
        quantity: 1,
        unitPrice: 11900,
        amount: 11900,
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.match(
    result.xml,
    /Tenant &amp; Agenda &lt;Lab&gt; &quot;Uno&quot; &apos;Dos&apos;/,
  );
  assert.match(result.xml, /Cliente &amp; Prueba &lt;QA&gt;/);
  assert.match(result.xml, /Servicio &amp; test &lt;premium&gt;/);
  assert.match(
    result.xml,
    /Incluye &quot;agenda&quot; y &apos;recordatorio&apos;/,
  );
});

test("returns clear error when required lab fields are invalid", () => {
  const result = buildBoletaXmlLab({
    ...draft,
    recipient: {
      ...draft.recipient,
      rut: "11.111.111-2",
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error, "Recipient RUT is invalid");
});

test("returns clear error when details are empty", () => {
  const result = buildBoletaXmlLab({
    ...draft,
    lines: [],
  });

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error, "At least one document detail is required");
});
