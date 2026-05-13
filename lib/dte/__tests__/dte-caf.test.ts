import assert from "node:assert/strict";
import test from "node:test";

import {
  createFolioStateFromCafLab,
  getFolioAvailability,
  markFolioUsed,
  reserveNextFolio,
} from "../caf/folio-manager.lab";
import {
  createFolioStateFromControlledCaf,
  reserveControlledFolio,
} from "../caf/folio-manager";
import { parseCafLabXmlToData } from "../caf/parse-caf";
import { parseCafRealControlledXml } from "../caf/parse-caf.real";
import { buildTedControlled } from "../caf/ted-builder";

const cafXml = `
<AUTORIZACION>
  <CAF version="1.0">
    <DA>
      <RE>76.123.456-0</RE>
      <TD>39</TD>
      <RNG><D>1001</D><H>1010</H></RNG>
      <FA>2026-05-08</FA>
    </DA>
  </CAF>
</AUTORIZACION>`;

test("parses CAF lab XML with issuer, document type and folio range", () => {
  const caf = parseCafLabXmlToData(cafXml, "tenant-lab");

  assert.equal(caf.mode, "lab");
  assert.equal(caf.isProductionValid, false);
  assert.equal(caf.issuerRut, "76123456-0");
  assert.equal(caf.documentType, "boleta_afecta");
  assert.equal(caf.rangeFrom, 1001);
  assert.equal(caf.rangeTo, 1010);
});

test("reserves and marks CAF lab folio as used in memory", () => {
  const caf = parseCafLabXmlToData(cafXml, "tenant-lab");
  const initialState = createFolioStateFromCafLab(caf);
  const reserved = reserveNextFolio(initialState);

  assert.equal(reserved.reservation.folio, 1001);
  assert.equal(reserved.reservation.status, "reserved");

  const used = markFolioUsed(reserved.state, reserved.reservation, "doc-lab");

  assert.equal(used.reservation.status, "used");
  assert.equal(used.reservation.documentId, "doc-lab");

  const availability = getFolioAvailability(used.state);
  assert.equal(availability.usedCount, 1);
  assert.equal(availability.availableCount, 9);
});

test("parses controlled CAF without marking it production valid", () => {
  const caf = parseCafRealControlledXml(cafXml, "tenant-lab");

  assert.equal(caf.mode, "controlled");
  assert.equal(caf.isProductionValid, false);
  assert.equal(caf.issuerRut, "76123456-0");
  assert.equal(caf.rangeFrom, 1001);
});

test("builds controlled TED with FRMT pending", () => {
  const result = buildTedControlled({
    issuerRut: "76123456-0",
    documentTypeCode: 39,
    folio: 1001,
    issueDate: "2026-05-08",
    recipientRut: "11111111-1",
    recipientLegalName: "Cliente Demo",
    totalAmount: 11900,
    firstItemName: "Reserva demo Citaya",
    cafXml,
    timestamp: "2026-05-08T12:00:00.000Z",
  });

  assert.equal(result.isProductionValid, false);
  assert.equal(result.frmtStatus, "pending_real_signature");
  assert.match(result.tedXml, /<TED version="1.0">/);
  assert.match(result.tedXml, /PENDIENTE-FIRMA-FRMT-CAF-REAL/);
});

test("reserves controlled CAF folio in memory", () => {
  const caf = parseCafRealControlledXml(cafXml, "tenant-lab");
  const state = createFolioStateFromControlledCaf(caf);
  const reserved = reserveControlledFolio(state);

  assert.equal(reserved.reservation.folio, 1001);
  assert.equal(reserved.state.availableCount, 9);
});
