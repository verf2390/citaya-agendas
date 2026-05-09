import assert from "node:assert/strict";
import test from "node:test";

import {
  createFolioStateFromCafLab,
  getFolioAvailability,
  markFolioUsed,
  reserveNextFolio,
} from "../caf/folio-manager.lab";
import { parseCafLabXmlToData } from "../caf/parse-caf";

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
