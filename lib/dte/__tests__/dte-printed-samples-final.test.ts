import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPdf,
  parseFinalDte,
  PRINTED_RECEIPT_DECLARATION,
  renderAndAudit,
  type CopySpec,
} from "../certification/factura-printed-samples-dry-run";
import { FINAL_PRINTED_SAMPLES_PLAN } from "../certification/printed-samples-final";
import { runFacturaSetDryRun } from "../certification/factura-set-dry-run";

const baseEnv = {
  PATH: process.env.PATH,
  DTE_MODE: "certification",
  DTE_SII_ENV: "certification",
};

type Built = Awaited<ReturnType<typeof buildPdf>> & {
  spec: CopySpec;
  text: string;
  decodedTedMatches: boolean;
};

let representativesPromise: Promise<Record<string, Built>> | undefined;

async function representatives(): Promise<Record<string, Built>> {
  if (representativesPromise) return representativesPromise;
  representativesPromise = (async () => {
    const root = mkdtempSync(join(tmpdir(), "citaya-printed-final-"));
    chmodSync(root, 0o700);
    const inputPath = join(root, "input.json");
    const sourceDir = join(root, "sources");
    const input = {
      issuer: {
        rutEmisor: "11111111-1",
        razonSocial: "R&G SPA",
        giroEmisor: "SERVICIOS DIGITALES",
        acteco: "620900",
        direccionOrigen: "DIRECCION FIXTURE",
        comunaOrigen: "COMUNA FIXTURE",
        ciudadOrigen: "CIUDAD FIXTURE",
        fechaResolucion: "2026-05-23",
        numeroResolucion: 0,
        rutEnvia: "12345678-5",
        periodoTributario: "2026-07",
      },
      receivers: {
        receiver1: { rut: "22222222-2", razonSocial: "RECEPTOR UNO", giro: "GIRO UNO", direccion: "D UNO", comuna: "C UNO", ciudad: "C UNO" },
        receiver2: { rut: "33333333-3", razonSocial: "RECEPTOR DOS", giro: "GIRO DOS", direccion: "D DOS", comuna: "C DOS", ciudad: "C DOS" },
        receiver3: { rut: "44444444-4", razonSocial: "RECEPTOR TRES", giro: "GIRO TRES", direccion: "D TRES", comuna: "C TRES", ciudad: "C TRES" },
        receiver4: { rut: "55555555-5", razonSocial: "RECEPTOR CUATRO", giro: "GIRO CUATRO", direccion: "D CUATRO", comuna: "C CUATRO", ciudad: "C CUATRO" },
      },
      textCorrection: {
        giroAnterior: "GIRO ANTERIOR",
        giroCorregido: "GIRO UNO",
      },
      purchaseProviders: {
        "4959700-1": { rut: "66666666-6", razonSocial: "PROVEEDOR UNO" },
        "4959700-2": { rut: "77777777-7", razonSocial: "PROVEEDOR DOS" },
        "4959700-3": { rut: "88888888-8", razonSocial: "PROVEEDOR TRES" },
        "4959700-4": { rut: "87654321-4", razonSocial: "PROVEEDOR CUATRO" },
        "4959700-5": { rut: "76543210-3", razonSocial: "PROVEEDOR CINCO" },
        "4959700-6": { rut: "11222333-9", razonSocial: "PROVEEDOR SEIS" },
        "4959700-7": { rut: "22111222-9", razonSocial: "PROVEEDOR SIETE" },
      },
    };
    writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
    chmodSync(inputPath, 0o600);
    runFacturaSetDryRun({
      outputDir: sourceDir,
      env: {
        ...baseEnv,
        DTE_FACTURA_PRE_CAF_INPUT_PATH: inputPath,
        DTE_CERTIFICATION_ISSUE_DATE: "2026-07-19",
      },
    });
    const sources = {
      invoice: parseFinalDte(
        join(sourceDir, "4959698-1-DTE-FIXTURE-SIN-VALIDEZ.xml"),
        "invoice",
      ),
      credit: parseFinalDte(
        join(sourceDir, "4959698-5-DTE-FIXTURE-SIN-VALIDEZ.xml"),
        "credit",
      ),
      debit: parseFinalDte(
        join(sourceDir, "4959698-8-DTE-FIXTURE-SIN-VALIDEZ.xml"),
        "debit",
      ),
    };
    const specs: Record<string, CopySpec> = {
      invoiceTax: {
        source: sources.invoice,
        cedible: false,
        fileName: "invoice-tax.pdf",
      },
      invoiceCedible: {
        source: sources.invoice,
        cedible: true,
        fileName: "invoice-cedible.pdf",
      },
      credit: {
        source: sources.credit,
        cedible: false,
        fileName: "credit.pdf",
      },
      debit: {
        source: sources.debit,
        cedible: false,
        fileName: "debit.pdf",
      },
    };
    const result: Record<string, Built> = {};
    for (const [name, spec] of Object.entries(specs)) {
      const built = await buildPdf(spec);
      const audit = await renderAndAudit(built.bytes, null, built.layout, spec);
      result[name] = {
        ...built,
        spec,
        text: audit.text,
        decodedTedMatches: audit.decodedTedMatches,
      };
    }
    return result;
  })();
  return representativesPromise;
}

test("factura tributaria no contiene acuse ni texto CEDIBLE", async () => {
  const sample = (await representatives()).invoiceTax;
  assert.doesNotMatch(sample.text, /Acuse de Recibo|CEDIBLE/);
});

test("factura cedible contiene acuse, campos, declaración legal y CEDIBLE", async () => {
  const sample = (await representatives()).invoiceCedible;
  assert.match(sample.text, /Acuse de Recibo/);
  for (const field of ["Nombre:", "RUT:", "Fecha:", "Recinto:", "Firma:", "CEDIBLE"])
    assert.ok(sample.text.includes(field));
  assert.ok(sample.text.includes(PRINTED_RECEIPT_DECLARATION));
});

test("notas de crédito y débito no son cedibles y muestran referencia completa", async () => {
  const samples = await representatives();
  for (const name of ["credit", "debit"]) {
    const sample = samples[name];
    assert.doesNotMatch(sample.text, /Acuse de Recibo|CEDIBLE/);
    assert.match(sample.text, /REFERENCIAS/);
    for (const reference of sample.spec.source.references)
      for (const value of [reference.folio, reference.date, reference.reason])
        assert.ok(sample.text.includes(value));
  }
});

test("PDF queda en una página, bajo 500 KB, con texto seleccionable y TED exacto", async () => {
  for (const sample of Object.values(await representatives())) {
    assert.equal(sample.layout.pageCount, 1);
    assert.ok(sample.bytes.length < 500 * 1024);
    assert.ok(sample.text.length > 100);
    assert.equal(sample.decodedTedMatches, true);
  }
});

test("plan final contiene exactamente las 16 muestras solicitadas", () => {
  assert.equal(FINAL_PRINTED_SAMPLES_PLAN.length, 16);
  assert.equal(
    FINAL_PRINTED_SAMPLES_PLAN.filter((sample) => sample.copy === "cedible").length,
    5,
  );
  assert.deepEqual(
    FINAL_PRINTED_SAMPLES_PLAN.map((sample) => sample.fileName),
    [
      "set-pruebas-caso-01-33-folio-5.pdf",
      "set-pruebas-caso-01-33-folio-5-cedible.pdf",
      "set-pruebas-caso-02-33-folio-6.pdf",
      "set-pruebas-caso-02-33-folio-6-cedible.pdf",
      "set-pruebas-caso-03-33-folio-7.pdf",
      "set-pruebas-caso-03-33-folio-7-cedible.pdf",
      "set-pruebas-caso-04-33-folio-8.pdf",
      "set-pruebas-caso-04-33-folio-8-cedible.pdf",
      "set-pruebas-caso-05-61-folio-4.pdf",
      "set-pruebas-caso-06-61-folio-5.pdf",
      "set-pruebas-caso-07-61-folio-6.pdf",
      "set-pruebas-caso-08-56-folio-2.pdf",
      "simulacion-33-folio-9.pdf",
      "simulacion-33-folio-9-cedible.pdf",
      "simulacion-56-folio-3.pdf",
      "simulacion-61-folio-7.pdf",
    ],
  );
});
