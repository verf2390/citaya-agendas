import assert from "node:assert/strict";
import test from "node:test";

import {
  BOLETA_ELECTRONICA_CERTIFICATION_CASES,
  buildBoletaCertificationDrafts,
  buildBoletaCertificationMetadata,
  buildBoletaCertificationSetEnvelopeXmlLab,
  buildRcofXmlLab,
  checkBoletaPreCafReadiness,
  isBoletaIssuerDataReady,
} from "../certification/boleta-electronica-set";

const realIssuer = {
  rut: "78195645-7",
  legalName: "R&G SpA",
  businessActivity: "Servicios digitales",
  address: "Regimiento Arica Nro 301 depto/local 215",
  commune: "Coquimbo",
  city: "Coquimbo",
  region: "Coquimbo",
  software: "CITAYA",
  url: "https://www.citaya.online",
};

test("models the five official boleta certification cases", () => {
  assert.deepEqual(
    BOLETA_ELECTRONICA_CERTIFICATION_CASES.map((certificationCase) => certificationCase.id),
    ["CASO-1", "CASO-2", "CASO-3", "CASO-4", "CASO-5"],
  );

  const drafts = buildBoletaCertificationDrafts({ issueDate: "2026-05-25", firstFolio: 1 });

  assert.equal(drafts.length, 5);
  assert.equal(drafts.every((draft) => draft.documentType === "boleta_afecta"), true);
  assert.deepEqual(
    drafts.map((draft) => draft.references?.[0]),
    [
      { code: "SET", reason: "CASO-1" },
      { code: "SET", reason: "CASO-2" },
      { code: "SET", reason: "CASO-3" },
      { code: "SET", reason: "CASO-4" },
      { code: "SET", reason: "CASO-5" },
    ],
  );
  assert.equal(drafts[3].lines.some((line) => line.exempt), true);
  assert.equal(drafts[4].lines[0].unitOfMeasure, "Kg");
});

test("generates a single dry-run envelope with references for all boleta cases", () => {
  const drafts = buildBoletaCertificationDrafts({
    issueDate: "2026-05-25",
    firstFolio: 10,
    issuer: realIssuer,
  });
  const result = buildBoletaCertificationSetEnvelopeXmlLab(drafts);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.match(result.xml, /NO PRODUCTIVO/);
  assert.match(result.xml, /<TpoDTE>39<\/TpoDTE>/);
  assert.match(result.xml, /<NroDTE>5<\/NroDTE>/);
  assert.equal((result.xml.match(/<DTE version="1.0">/g) ?? []).length, 5);
  assert.equal((result.xml.match(/<CodRef>SET<\/CodRef>/g) ?? []).length, 5);
  assert.match(result.xml, /<RazonRef>CASO-5<\/RazonRef>/);
  assert.match(result.xml, /<IndExe>1<\/IndExe>/);
  assert.match(result.xml, /<UnmdItem>Kg<\/UnmdItem>/);
});

test("generates RCOF lab summary for the same boleta folio range", () => {
  const drafts = buildBoletaCertificationDrafts({
    issueDate: "2026-05-25",
    firstFolio: 20,
    issuer: realIssuer,
  });
  const rcof = buildRcofXmlLab(drafts);

  assert.match(rcof, /NO PRODUCTIVO/);
  assert.match(rcof, /<TipoDocumento>39<\/TipoDocumento>/);
  assert.match(rcof, /<FoliosEmitidos>5<\/FoliosEmitidos>/);
  assert.match(rcof, /<Inicial>20<\/Inicial>/);
  assert.match(rcof, /<Final>24<\/Final>/);
  assert.match(rcof, /<MntExento>2000<\/MntExento>/);
});


test("pre-CAF check passes only with real issuer data and CAF absent", () => {
  const drafts = buildBoletaCertificationDrafts({
    issueDate: "2026-05-25",
    firstFolio: 1,
    issuer: realIssuer,
  });
  const setResult = buildBoletaCertificationSetEnvelopeXmlLab(drafts);
  assert.equal(setResult.ok, true);
  if (!setResult.ok) return;

  const metadata = {
    ...buildBoletaCertificationMetadata(drafts, realIssuer),
    submitBlocked: true,
    production: false,
    trackIdSimulated: false,
  };
  const result = checkBoletaPreCafReadiness({
    setXml: setResult.xml,
    rcofXml: buildRcofXmlLab(drafts),
    metadata,
    cafPresent: false,
    cafKeyPresent: false,
  });

  assert.equal(isBoletaIssuerDataReady(realIssuer), true);
  assert.equal(result.status, "OK PARA BAJAR CAF");
  assert.equal(result.preCafReady, true);
});

test("pre-CAF check blocks unconfigured issuer data", () => {
  const drafts = buildBoletaCertificationDrafts({ issueDate: "2026-05-25", firstFolio: 1 });
  const setResult = buildBoletaCertificationSetEnvelopeXmlLab(drafts);
  assert.equal(setResult.ok, true);
  if (!setResult.ok) return;

  const result = checkBoletaPreCafReadiness({
    setXml: setResult.xml,
    rcofXml: buildRcofXmlLab(drafts),
    metadata: {
      ...buildBoletaCertificationMetadata(drafts),
      submitBlocked: true,
      production: false,
      trackIdSimulated: false,
    },
    cafPresent: false,
    cafKeyPresent: false,
  });

  assert.equal(result.status, "NO BAJAR CAF");
  assert.equal(result.preCafReady, false);
});
