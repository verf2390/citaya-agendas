import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditFacturaBooksFinalFiles, runFacturaBooksDryRun } from "../certification/factura-books-dry-run";

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
