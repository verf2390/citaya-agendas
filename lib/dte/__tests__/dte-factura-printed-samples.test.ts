import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPrintedSamplesDryRun } from "../certification/factura-printed-samples-dry-run";
import { FACTURA_SET_FIXTURE_OUTPUT_DIR } from "../certification/factura-set-dry-run";

const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, DTE_SII_ENV: "certification" };
function negative(overrides: Record<string, unknown>, pattern: RegExp) {
  return assert.rejects(() => runPrintedSamplesDryRun({ env: baseEnv, repoRoot: process.cwd(), sourceDir: FACTURA_SET_FIXTURE_OUTPUT_DIR, skipSourceGeneration: true, printedOutputDir: mkdtempSync(join(tmpdir(), "citaya-pre-caf-11-negative-")), overrides }), pattern);
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
