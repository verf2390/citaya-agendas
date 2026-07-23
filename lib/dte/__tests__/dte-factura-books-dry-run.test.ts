import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditFacturaBooksFinalFiles, executeRecordedMultipartTransport, runFacturaBooksDryRun } from "../certification/factura-books-dry-run";
import { buildPurchaseBookModel, serializePurchaseBookXml } from "../certification/purchase-book";
import { buildSalesBookModel, serializeSalesBookXml } from "../certification/sales-book";
import { signXmlInFinalContextControlled } from "../signing/sign-xml.real";

const SALES = "LibroVentas-4959699-FIXTURE-SIN-VALIDEZ.xml";
const PURCHASE = "LibroCompras-4959700-FIXTURE-SIN-VALIDEZ.xml";
const MANIFEST = "manifest-4959699-4959700-FIXTURE-SIN-VALIDEZ.json";

function inputFixture() {
  return {
    issuer: { rutEmisor: "11111111-1", razonSocial: "EMISOR FIXTURE", giroEmisor: "GIRO FIXTURE", acteco: "620900", direccionOrigen: "DIRECCION FIXTURE", comunaOrigen: "COMUNA FIXTURE", ciudadOrigen: "CIUDAD FIXTURE", fechaResolucion: "2026-05-23", numeroResolucion: 0, rutEnvia: "12345678-5", periodoTributario: "2026-07" },
    receivers: {
      receiver1: { rut: "22222222-2", razonSocial: "RECEPTOR UNO", giro: "GIRO UNO", direccion: "D UNO", comuna: "C UNO", ciudad: "C UNO" },
      receiver2: { rut: "33333333-3", razonSocial: "RECEPTOR DOS", giro: "GIRO DOS", direccion: "D DOS", comuna: "C DOS", ciudad: "C DOS" },
      receiver3: { rut: "44444444-4", razonSocial: "RECEPTOR TRES", giro: "GIRO TRES", direccion: "D TRES", comuna: "C TRES", ciudad: "C TRES" },
      receiver4: { rut: "55555555-5", razonSocial: "RECEPTOR CUATRO", giro: "GIRO CUATRO", direccion: "D CUATRO", comuna: "C CUATRO", ciudad: "C CUATRO" },
    },
    textCorrection: { giroAnterior: "GIRO ANTERIOR", giroCorregido: "GIRO UNO" },
    purchaseProviders: {
      "4959700-1": { rut: "66666666-6", razonSocial: "PROVEEDOR UNO" }, "4959700-2": { rut: "77777777-7", razonSocial: "PROVEEDOR DOS" },
      "4959700-3": { rut: "88888888-8", razonSocial: "PROVEEDOR TRES" }, "4959700-4": { rut: "87654321-4", razonSocial: "PROVEEDOR CUATRO" },
      "4959700-5": { rut: "76543210-3", razonSocial: "PROVEEDOR CINCO" }, "4959700-6": { rut: "11222333-9", razonSocial: "PROVEEDOR SEIS" },
      "4959700-7": { rut: "22111222-9", razonSocial: "PROVEEDOR SIETE" },
    },
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "citaya-pre-caf-10-test-"));
  const inputPath = join(root, "input.json"); const outputDir = join(root, "output");
  writeFileSync(inputPath, JSON.stringify(inputFixture()), "utf8");
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DTE_SII_ENV: "certification", DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath, DTE_CERTIFICATION_ISSUE_DATE: "2026-07-19" };
  return { outputDir, env };
}

function generate(value = fixture()) { runFacturaBooksDryRun({ ...value }); return value; }
function updateHash(outputDir: string, fileName: string) {
  const path = join(outputDir, MANIFEST); const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.files.find((item: { file: string }) => item.file === fileName).sha256 = createHash("sha256").update(readFileSync(join(outputDir, fileName))).digest("hex");
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf8");
}

for (const [name, overrides, pattern] of [
  ["URI/ID incorrecto", { wrongReferenceUri: true }, /Reference URI/],
  ["firma vacia", { signatureValueEmpty: true }, /firma XMLDSig/],
  ["firma falsa", { signatureValueFake: true }, /firma XMLDSig/],
  ["periodo incorrecto", { wrongPeriod: true }, /contenido final/],
  ["FolioNotificacion intercambiado", { swappedNotificationFolios: true }, /contenido final/],
  ["TipoOperacion incorrecto", { wrongOperation: true }, /contenido final/],
  ["detalle faltante", { missingSalesDetail: true }, /contenido final/],
  ["detalle duplicado", { duplicatePurchaseDetail: true }, /contenido final/],
] as const) {
  test(`PRE-CAF 10 rechaza ${name}`, () => {
    const value = fixture();
    assert.throws(() => runFacturaBooksDryRun({ ...value, overrides }), pattern);
  });
}

test("PRE-CAF 10 rechaza certificado y llave fixture distintos", () => {
  const value = fixture();
  assert.throws(() => runFacturaBooksDryRun({ ...value, overrides: { mismatchedCertificateKey: true } }), /no hacen par/);
});

test("PRE-CAF 10 rechaza detalle y ResumenPeriodo alterados despues de firmar", () => {
  const first = generate(); const salesPath = join(first.outputDir, SALES);
  writeFileSync(salesPath, Buffer.from(readFileSync(salesPath).toString("latin1").replace("<MntTotal>147417</MntTotal>", "<MntTotal>147418</MntTotal>"), "latin1")); updateHash(first.outputDir, SALES);
  assert.throws(() => auditFacturaBooksFinalFiles({ ...first, skipGeneration: true }), /contenido final|firma XMLDSig/);
  const second = generate(); const purchasePath = join(second.outputDir, PURCHASE);
  writeFileSync(purchasePath, Buffer.from(readFileSync(purchasePath).toString("latin1").replace("<TotDoc>2</TotDoc>", "<TotDoc>3</TotDoc>"), "latin1")); updateHash(second.outputDir, PURCHASE);
  assert.throws(() => auditFacturaBooksFinalFiles({ ...second, skipGeneration: true }), /contenido final|firma XMLDSig/);
});

test("PRE-CAF 10 rechaza encoding incompatible y BOM", () => {
  const value = generate(); const path = join(value.outputDir, SALES);
  writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(path)]));
  assert.throws(() => auditFacturaBooksFinalFiles({ ...value, skipGeneration: true }), /BOM/);
});

test("PRE-CAF 10 bloquea production y rutas reales", () => {
  const value = fixture();
  assert.throws(() => runFacturaBooksDryRun({ ...value, env: { ...value.env, DTE_SII_ENV: "production" } }), /certification/);
  assert.throws(() => runFacturaBooksDryRun({ ...value, overrides: { realCertificatePath: "/tmp/real.pem" } }), /certificado real/);
});

test("Libro Ventas correction-001 declara schemaLocation antes de firma y verifica en contexto final", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-sales-book-correction-test-"));
  const keyPath = join(root, "key.pem"); const certPath = join(root, "cert.pem"); const xmlPath = join(root, "book.xml");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-nodes", "-days", "2", "-subj", "/CN=Sales Book Correction Fixture/C=CL"], { stdio: "ignore" });
  chmodSync(keyPath, 0o600); chmodSync(certPath, 0o600);
  const input = inputFixture(); const receiverKeys = ["receiver1", "receiver2", "receiver3", "receiver4", "receiver1", "receiver2", "receiver3", "receiver1"] as const;
  const details = Object.fromEntries(receiverKeys.map((key, index) => [`4959698-${index + 1}`, { folio: index + 1, recipientRut: input.receivers[key].rut, recipientName: input.receivers[key].razonSocial }]));
  const model = buildSalesBookModel({
    issueDate: "2026-07-22", taxPeriod: "2026-07",
    externalData: { rutEmisorLibro: input.issuer.rutEmisor, rutEnvia: input.issuer.rutEnvia, fchResol: input.issuer.fechaResolucion, nroResol: input.issuer.numeroResolucion },
    details, textCorrection: { previousBusinessActivity: input.textCorrection.giroAnterior, correctedBusinessActivity: input.textCorrection.giroCorregido },
  });
  const id = "LibroVentas-4959699";
  const unsigned = serializeSalesBookXml(model, { id, includeSchemaLocation: true, timestamp: "2026-07-23T12:00:00" });
  assert.match(unsigned, /<LibroCompraVenta\b[^>]*xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"[^>]*xsi:schemaLocation="http:\/\/www\.sii\.cl\/SiiDte LibroCV_v10\.xsd"/);
  const signed = signXmlInFinalContextControlled({
    xml: unsigned, referenceId: id, insertAfterXPath: `//*[local-name()='EnvioLibro' and @ID='${id}']`,
  }, { tenantId: "sales-book-correction-test", mode: "certification", signatureTarget: id, privateKeyPath: keyPath, certificatePath: certPath, publicCertificatePath: certPath });
  writeFileSync(xmlPath, Buffer.from(signed.signedXml, "latin1"), { mode: 0o600 });
  const verify = (path: string) => spawnSync("xmlsec1", ["--verify", "--id-attr:ID", "EnvioLibro", "--pubkey-cert-pem", certPath, "--node-xpath", `//*[local-name()='Signature'][.//*[local-name()='Reference' and @URI='#${id}']]`, path], { stdio: "ignore" }).status;
  assert.equal(verify(xmlPath), 0);
  const alteredPath = join(root, "book-altered.xml");
  writeFileSync(alteredPath, Buffer.from(signed.signedXml.replace('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"', 'xmlns:xsi="urn:altered-after-signing"'), "latin1"), { mode: 0o600 });
  assert.notEqual(verify(alteredPath), 0);
});

test("delivery attempt-002 registra transporte y body en orden", async () => {
  const events: Array<Record<string, unknown>> = [];
  const responseXml = "<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>1234567890</TRACKID></RECEPCIONDTE>";
  const result = await executeRecordedMultipartTransport({
    endpoint: "https://maullin.sii.cl/cgi_dte/UPL/DTEUpload",
    request: { method: "POST", body: new FormData() },
    append: (event) => events.push(event),
    fetchImpl: async () => {
      assert.equal(events.at(-1)?.stage, "upload_started");
      return new Response(responseXml, { status: 200, headers: { "content-type": "text/xml" } });
    },
  });
  assert.equal(result.raw, responseXml);
  assert.deepEqual(events.map((event) => event.stage), [
    "upload_started", "response_headers_received", "response_body_started", "response_body_stored",
  ]);
  assert.equal(events[1].httpStatus, 200);
  assert.equal(events[3].responseBodyStored, true);
  assert.equal(events[3].responseBody, responseXml);
});

test("Libro Compras 4959700 corrige exactamente tipo 46 folio 9 y conserva sus totales", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-purchase-book-test-"));
  const keyPath = join(root, "key.pem"); const certPath = join(root, "cert.pem"); const xmlPath = join(root, "purchase.xml");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-nodes", "-days", "2", "-subj", "/CN=Purchase Book Fixture/C=CL"], { stdio: "ignore" });
  chmodSync(keyPath, 0o600); chmodSync(certPath, 0o600);
  const input = inputFixture();
  const providers = Object.fromEntries(Object.entries(input.purchaseProviders).map(([caseId, provider]) => [
    caseId,
    { rut: caseId === "4959700-6" ? "97004000-5" : provider.rut, name: provider.razonSocial },
  ]));
  const model = buildPurchaseBookModel({
    externalData: {
      rutEmisorLibro: input.issuer.rutEmisor, rutEnvia: input.issuer.rutEnvia,
      periodoTributario: input.issuer.periodoTributario, fchResol: input.issuer.fechaResolucion,
      nroResol: input.issuer.numeroResolucion,
    },
    providers, salesBookPeriod: "2026-07",
  });
  assert.equal(model.detalle.length, 7);
  assert.deepEqual(model.detalle.map((detail) => [detail.tpoDoc, detail.folio]), [[30, 234], [33, 32], [30, 781], [60, 451], [33, 67], [46, 9], [60, 211]]);
  const type46Folio9 = model.detalle.find((detail) => detail.tpoDoc === 46 && detail.folio === 9);
  assert.deepEqual(type46Folio9, {
    caseId: "4959700-6",
    tpoDoc: 46,
    folio: 9,
    fchDoc: "2026-07-01",
    providerRut: "97004000-5",
    providerName: "PROVEEDOR SEIS",
    observation: "COMPRA CON RETENCION TOTAL DEL IVA",
    mntExe: 0,
    mntNeto: 9037,
    mntIVA: 1717,
    ivaUsoComun: 0,
    ivaNoRec: undefined,
    otrosImp: { codImp: 15, tasaImp: 19, mntImp: 1717 },
    ivaRetTotal: 1717,
    ivaNoRetenido: 0,
    mntTotal: 9037,
  });
  assert.deepEqual(model.resumenPeriodo.find((total) => total.tpoDoc === 46), {
    tpoDoc: 46,
    totDoc: 1,
    totMntExe: 0,
    totMntNeto: 9037,
    totOpIVARec: 1,
    totMntIVA: 1717,
    totOtrosImp: { codImp: 15, totMntImp: 1717 },
    totOpIVARetTotal: 1,
    totIVARetTotal: 1717,
    totMntTotal: 9037,
    totOpIVANoRetenido: 1,
    totIVANoRetenido: 0,
  });
  const id = "LibroCompras-4959700";
  const unsigned = serializePurchaseBookXml(model, { id, includeSchemaLocation: true, timestamp: "2026-07-23T12:00:00" });
  assert.match(unsigned, /<LibroCompraVenta\b[^>]*xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"[^>]*xsi:schemaLocation="http:\/\/www\.sii\.cl\/SiiDte LibroCV_v10\.xsd"/);
  assert.match(unsigned, /<TpoDoc>46<\/TpoDoc>[\s\S]*?<NroDoc>9<\/NroDoc>[\s\S]*?<TasaImp>19<\/TasaImp>[\s\S]*?<FchDoc>2026-07-01<\/FchDoc>[\s\S]*?<RUTDoc>97004000-5<\/RUTDoc>[\s\S]*?<MntNeto>9037<\/MntNeto>[\s\S]*?<MntIVA>1717<\/MntIVA>[\s\S]*?<CodImp>15<\/CodImp>[\s\S]*?<MntImp>1717<\/MntImp>[\s\S]*?<IVARetTotal>1717<\/IVARetTotal>[\s\S]*?<MntTotal>9037<\/MntTotal>/);
  const signed = signXmlInFinalContextControlled({
    xml: unsigned, referenceId: id, insertAfterXPath: `//*[local-name()='EnvioLibro' and @ID='${id}']`,
  }, { tenantId: "purchase-book-test", mode: "certification", signatureTarget: id, privateKeyPath: keyPath, certificatePath: certPath, publicCertificatePath: certPath });
  writeFileSync(xmlPath, Buffer.from(signed.signedXml, "latin1"), { mode: 0o600 });
  const verified = spawnSync("xmlsec1", ["--verify", "--id-attr:ID", "EnvioLibro", "--pubkey-cert-pem", certPath, "--node-xpath", `//*[local-name()='Signature'][.//*[local-name()='Reference' and @URI='#${id}']]`, xmlPath], { stdio: "ignore" });
  assert.equal(verified.status, 0);
});
