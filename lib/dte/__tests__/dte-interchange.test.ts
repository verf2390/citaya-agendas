import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildInterchangeXmls,
  RECEIPT_DECLARATION,
  validateInterchangeArtifacts,
  type InterchangeModel,
} from "../interchange/interchange-prepare";

type Fixture = ReturnType<typeof makeFixture>;
let cached: Fixture | undefined;

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "citaya-interchange-"));
  chmodSync(root, 0o700);
  const cert = join(root, "cert.pem");
  const key = join(root, "key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      cert,
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=Interchange Fixture/serialNumber=76086428-5/C=CL",
    ],
    { stdio: "ignore" },
  );
  chmodSync(cert, 0o600);
  chmodSync(key, 0o600);
  const model: InterchangeModel = {
    inputFileName: "ENVIO_DTE_FIXTURE.xml",
    setDteId: "SetDTE-FIXTURE-4970282",
    outerDigest: Buffer.alloc(20, 7).toString("base64"),
    envelopeIssuerRut: "60803000-K",
    envelopeReceiverRut: "76086428-5",
    responseId: 4_970_282,
    generatedAt: "2026-07-23T16:00:00",
    signerRut: "76086428-5",
    recinto: "RECINTO EXTERNO FIXTURE",
    documents: [
      {
        typeCode: 33,
        folio: 52_919,
        issueDate: "2026-07-23",
        issuerRut: "60803000-K",
        receiverRut: "76086428-5",
        total: 119_000,
        receiverMatchesEnvelope: true,
      },
      {
        typeCode: 33,
        folio: 52_920,
        issueDate: "2013-06-21",
        issuerRut: "60803000-K",
        receiverRut: "11111111-1",
        total: 238_000,
        receiverMatchesEnvelope: false,
      },
    ],
  };
  const generated = buildInterchangeXmls(model, {
    certificatePath: cert,
    privateKeyPath: key,
  });
  const validation = validateInterchangeArtifacts({
    generated,
    directory: root,
    certificatePath: cert,
  });
  return { root, cert, key, model, generated, validation };
}

function fixture(): Fixture {
  return (cached ??= makeFixture());
}

test("interchange reception accepts the correct receiver and rejects the wrong receiver with code 3", () => {
  const { generated, validation } = fixture();
  assert.equal(validation.receptionDetails, 2);
  assert.match(
    generated.receptionXml,
    /<Folio>52919<\/Folio>[\s\S]*?<EstadoRecepDTE>0<\/EstadoRecepDTE>[\s\S]*?<RecepDTEGlosa>DTE RECIBIDO OK<\/RecepDTEGlosa>/,
  );
  assert.match(
    generated.receptionXml,
    /<Folio>52920<\/Folio>[\s\S]*?<EstadoRecepDTE>3<\/EstadoRecepDTE>[\s\S]*?RUT RECEPTOR NO CORRESPONDE/,
  );
});

test("interchange commercial result accepts 52919 and rejects 52920 with code 2", () => {
  const { generated, validation } = fixture();
  assert.equal(validation.commercialDetails, 2);
  assert.equal(validation.commercialAcceptedFolio52919, true);
  assert.equal(validation.commercialRejectedFolio52920, true);
  assert.match(
    generated.commercialXml,
    /<Folio>52919<\/Folio>[\s\S]*?<EstadoDTE>0<\/EstadoDTE><EstadoDTEGlosa>ACEPTADO OK<\/EstadoDTEGlosa>/,
  );
  assert.match(
    generated.commercialXml,
    /<Folio>52920<\/Folio>[\s\S]*?<EstadoDTE>2<\/EstadoDTE>[\s\S]*?RUT RECEPTOR NO CORRESPONDE/,
  );
});

test("Ley 19.983 receipt contains only the valid document and the official declaration", () => {
  const { generated, validation } = fixture();
  assert.equal(validation.receiptDetails, 1);
  assert.equal(validation.receiptContainsFolio52919, true);
  assert.equal(validation.receiptContainsFolio52920, false);
  assert.match(generated.receiptXml, /<Folio>52919<\/Folio>/);
  assert.doesNotMatch(generated.receiptXml, /<Folio>52920<\/Folio>/);
  assert.ok(
    generated.receiptXml.includes(
      RECEIPT_DECLARATION.replace(/&/g, "&amp;"),
    ),
  );
});

test("RecepcionEnvio and ResultadoDTE are mutually exclusive", () => {
  const { generated, validation } = fixture();
  assert.equal(validation.responseSectionsMutuallyExclusive, true);
  assert.match(generated.receptionXml, /<RecepcionEnvio>/);
  assert.doesNotMatch(generated.receptionXml, /<ResultadoDTE>/);
  assert.doesNotMatch(generated.commercialXml, /<RecepcionEnvio>/);
  assert.match(generated.commercialXml, /<ResultadoDTE>/);
});

test("the three interchange formats pass official XSD and xmlsec1 gates", () => {
  const { root, validation } = fixture();
  assert.equal(validation.receptionXsd, "valid");
  assert.equal(validation.receptionXmlsec1, "valid");
  assert.equal(validation.receiptXsd, "valid");
  assert.equal(validation.receiptIndividualXmlsec1, "1/1");
  assert.equal(validation.receiptOuterXmlsec1, true);
  assert.equal(validation.commercialXsd, "valid");
  assert.equal(validation.commercialXmlsec1, "valid");
  assert.equal(validation.referencesValid, true);
  assert.equal(validation.encoding, "ISO-8859-1");
  for (const name of [
    "respuesta-recepcion.xml",
    "recibo-mercaderias-servicios.xml",
    "resultado-comercial.xml",
  ])
    assert.equal(readFileSync(join(root, name)).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
});
