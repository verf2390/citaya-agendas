import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
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
import { signFrmtControlled } from "../caf/frmt-signature";
import { parseCafRealControlledXml, validateCafForDraftOrThrow } from "../caf/parse-caf.real";
import { buildTedControlled } from "../caf/ted-builder";

const cafXml = `
<AUTORIZACION>
  <CAF version="1.0">
    <DA>
      <RE>76.123.456-0</RE>
      <RS>Empresa Demo Citaya SpA</RS>
      <TD>39</TD>
      <RNG><D>1001</D><H>1010</H></RNG>
      <FA>2026-05-08</FA>
      <RSAPK><M>AA==</M><E>AQAB</E></RSAPK>
      <IDK>1</IDK>
    </DA>
    <FRMA algoritmo="SHA1withRSA">AA==</FRMA>
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


test("rejects malformed controlled CAF", () => {
  assert.throws(
    () => parseCafRealControlledXml(cafXml.replace('<FRMA algoritmo="SHA1withRSA">AA==</FRMA>', ""), "tenant-lab"),
    /falta <FRMA>/,
  );
});

test("validates controlled CAF folio and document type against draft", () => {
  const caf = parseCafRealControlledXml(cafXml, "tenant-lab");
  const baseDraft = {
    tenantId: "tenant-lab",
    issueMode: "citaya_own_dte" as const,
    documentType: "boleta_afecta" as const,
    status: "draft" as const,
    folio: 1001,
    issueDate: "2026-05-08",
    issuer: {
      tenantId: "tenant-lab",
      rut: "76.123.456-0",
      legalName: "Empresa Demo Citaya SpA",
      businessActivity: "Servicios",
      address: "Av. Uno 123",
      commune: "La Serena",
      city: "La Serena",
      dteEnvironment: "certification" as const,
    },
    recipient: { rut: "11.111.111-1", legalName: "Cliente Demo" },
    lines: [{ name: "Reserva", quantity: 1, unitPrice: 10000, amount: 10000 }],
    totalAmount: 11900,
  };

  assert.doesNotThrow(() => validateCafForDraftOrThrow(caf, baseDraft));
  assert.throws(
    () => validateCafForDraftOrThrow(caf, { ...baseDraft, folio: 999 }),
    /fuera del rango CAF/,
  );
  assert.throws(
    () => validateCafForDraftOrThrow(caf, { ...baseDraft, documentType: "factura_afecta" }),
    /tipo DTE no coincide/,
  );
});

test("FRMT does not generate real signature without CAF private key", () => {
  const ted = buildTedControlled({
    issuerRut: "76123456-0",
    documentTypeCode: 39,
    folio: 1001,
    issueDate: "2026-05-08",
    recipientRut: "11111111-1",
    recipientLegalName: "Cliente Demo",
    totalAmount: 11900,
    firstItemName: "Reserva demo Citaya",
    cafXml,
    timestamp: "2026-05-08T12:00:00",
  });

  const frmt = signFrmtControlled({ ddXml: ted.ddXml, mode: "certification" });

  assert.equal(frmt.ok, false);
  if (!frmt.ok) {
    assert.equal(frmt.status, "missing_secret");
    assert.ok(frmt.missing.includes("DTE_CAF_PRIVATE_KEY_PATH"));
  }
  assert.equal(ted.frmtStatus, "pending_real_signature");
});

test("FRMT can sign DD with explicit external fixture key without printing it", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const ted = buildTedControlled({
    issuerRut: "76123456-0",
    documentTypeCode: 39,
    folio: 1001,
    issueDate: "2026-05-08",
    recipientRut: "11111111-1",
    recipientLegalName: "Cliente Demo",
    totalAmount: 11900,
    firstItemName: "Reserva demo Citaya",
    cafXml,
    timestamp: "2026-05-08T12:00:00",
  });

  const frmt = signFrmtControlled({
    ddXml: ted.ddXml,
    privateKeyPem,
    mode: "certification",
  });

  assert.equal(frmt.ok, true);
  if (frmt.ok) {
    assert.match(frmt.frmtXml, /<FRMT algoritmo="SHA1withRSA">/);
    assert.doesNotMatch(frmt.frmtXml, /BEGIN RSA PRIVATE KEY/);
  }
});


test("FOCAL FRMT SII signs the compact ISO-8859-1 DD and verifies independently", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const toBase64 = (value: string) => Buffer.from(value, "base64url").toString("base64");
  const ddXml = [
    "<DD xmlns=\"http://www.sii.cl/SiiDte\">",
    "  <RE>76123456-0</RE>",
    "  <TD>33</TD>",
    "  <F>1</F>",
    "  <FE>2026-07-22</FE>",
    "  <RR>11111111-1</RR>",
    "  <RSR>Señor &amp; Compañía</RSR>",
    "  <MNT>11900</MNT>",
    "  <IT1>Cajón &amp; Pañuelo</IT1>",
    `  <CAF xmlns=\"http://www.sii.cl/SiiDte\"><DA><RSAPK><M>${toBase64(jwk.n)}</M><E>${toBase64(jwk.e)}</E></RSAPK></DA><FRMA algoritmo=\"SHA1withRSA\">AA==</FRMA></CAF>`,
    "  <TSTED>2026-07-22T12:00:00</TSTED>",
    "</DD>",
  ].join("\n");
  const signed = signFrmtControlled({
    ddXml,
    privateKeyPem: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    mode: "certification",
  });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  const officialDd = ddXml
    .replace(/\s+xmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*(?:"[^"]*"|\x27[^\x27]*\x27)/g, "")
    .replace(/>\s+</g, "><");
  const frmt = signed.frmtXml.match(/<FRMT[^>]*>([\s\S]*?)<\/FRMT>/)?.[1] ?? "";
  const verifier = createVerify("RSA-SHA1");
  verifier.update(Buffer.from(officialDd, "latin1"));
  assert.equal(verifier.verify(publicKey, frmt, "base64"), true);
  assert.ok(frmt.split("\n").every((line) => line.length <= 76));
});
