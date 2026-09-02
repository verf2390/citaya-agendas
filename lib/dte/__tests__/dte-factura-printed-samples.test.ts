import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPrintedSamplesDryRun } from "../certification/factura-printed-samples-dry-run";
import { runFacturaSetDryRun } from "../certification/factura-set-dry-run";

const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, DTE_MODE: "certification", DTE_SII_ENV: "certification" };
let temporarySourceDir: string | undefined;
function sourceFixture(): string {
  if (temporarySourceDir) return temporarySourceDir;
  const root = mkdtempSync(join(tmpdir(), "citaya-pre-caf-11-source-"));
  const inputPath = join(root, "input.json");
  const sourceDir = join(root, "set");
  const input = {
    issuer: { rutEmisor: "11111111-1", razonSocial: "R&G SPA", giroEmisor: "SERVICIOS DIGITALES", acteco: "620900", direccionOrigen: "DIRECCION FIXTURE", comunaOrigen: "COMUNA FIXTURE", ciudadOrigen: "CIUDAD FIXTURE", fechaResolucion: "2026-05-23", numeroResolucion: 0, rutEnvia: "12345678-5", periodoTributario: "2026-07" },
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
  writeFileSync(inputPath, JSON.stringify(input), { encoding: "utf8", mode: 0o600 }); chmodSync(inputPath, 0o600);
  runFacturaSetDryRun({ outputDir: sourceDir, env: { ...baseEnv, DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath, DTE_CERTIFICATION_ISSUE_DATE: "2026-07-19" } });
  temporarySourceDir = sourceDir;
  return sourceDir;
}
function negative(overrides: Record<string, unknown>, pattern: RegExp) {
  return assert.rejects(() => runPrintedSamplesDryRun({ env: baseEnv, repoRoot: process.cwd(), sourceDir: sourceFixture(), skipSourceGeneration: true, printedOutputDir: mkdtempSync(join(tmpdir(), "citaya-pre-caf-11-negative-")), overrides }), pattern);
}

test("PRE-CAF 11 rechaza pagina extra", () => negative({ extraPage: true }, /exactamente una pagina/));
test("PRE-CAF 11 rechaza PDF417 inferior al minimo", () => negative({ barcodeWidth: 100 }, /inferior al minimo/));
test("PRE-CAF 11 rechaza PDF417 fuera del margen", () => negative({ barcodeX: 20 }, /fuera de margen/));
test("PRE-CAF 11 rechaza PDF417 ilegible o corrupto", () => negative({ corruptBarcode: true }, /PDF417|PNG|image|decompress/i));
test("PRE-CAF 11 rechaza TED decodificado distinto", () => negative({ mismatchedTed: true }, /TED decodificado/));
test("PRE-CAF 11 rechaza totales distintos", () => negative({ alterTotals: true }, /contenido tributario requerido/));
test("PRE-CAF 11 rechaza descuentos omitidos", () => negative({ omitDiscounts: true }, /descuento/));
test("PRE-CAF 11 rechaza referencias omitidas", () => negative({ omitReferences: true }, /referencias/));
test("PRE-CAF 11 rechaza copia cedible incompleta", async () => { await negative({ omitCedibleLabel: true }, /cedible incompleta/); await negative({ omitReceiptBox: true }, /cedible incompleta/); });
test("PRE-CAF 11 rechaza acuse en copia no cedible", () => negative({ receiptOnTaxCopy: true }, /copia no cedible/));
test("PRE-CAF 11 rechaza contenido recortado y texto comercial", async () => { await negative({ clippedContent: true }, /fuera de pagina/); await negative({ commercialText: true }, /texto comercial/); });
test("PRE-CAF 11 bloquea CAF, certificados, production y escritura en Git", async () => {
  await assert.rejects(() => runPrintedSamplesDryRun({ env: { ...baseEnv, DTE_SII_ENV: "production" } }), /certification/);
  await negative({ realCafPath: "/tmp/caf-real.xml" }, /CAF\/certificado real/);
  await negative({ realCertificatePath: "/tmp/cert-real.pem" }, /CAF\/certificado real/);
  await assert.rejects(() => runPrintedSamplesDryRun({ env: baseEnv, printedOutputDir: join(process.cwd(), "tmp", "printed") }), /dentro del repositorio/);
});
