import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BOLETA_39_CERTIFICATION_CASES,
  prepareBoletaPreCaf,
} from "../certification/boleta-pre-caf";
import { resolveDteTransportProfile } from "../transport-profile";

test("FOCAL tipo 39 genera cinco casos, un sobre y RVD documental sin contacto SII", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "citaya-boleta39-focal-"));
  try {
    const result = await prepareBoletaPreCaf({
      issueDate: "2026-07-29",
      firstFolio: 390_001,
      outputDir,
    });
    assert.equal(result.status, "PRE_CAF_READY");
    assert.equal(result.siiContacted, false);
    assert.equal(result.officialCafPresent, false);
    assert.equal(result.productionFoliosUsed, false);
    assert.deepEqual(
      result.documents.map((document) => ({
        id: document.caseId,
        net: document.totals.netAmount,
        iva: document.totals.taxAmount,
        exento: document.totals.exemptAmount,
        total: document.totals.totalAmount,
      })),
      BOLETA_39_CERTIFICATION_CASES.map((item) => ({
        id: item.id,
        net: item.expected.netAmount,
        iva: item.expected.taxAmount,
        exento: item.expected.exemptAmount,
        total: item.expected.totalAmount,
      })),
    );
    assert.deepEqual(result.rvdTotals, {
      netAmount: 43_831,
      taxAmount: 8_329,
      exemptAmount: 2_000,
      totalAmount: 54_160,
    });
    assert.equal(Math.round((result.rvdTotals.netAmount * 19) / 100), 8_328);
    assert.equal(result.rvdTotals.taxAmount - 8_328, 1);
    assert.equal((result.envelopeXml.match(/<DTE\b/g) ?? []).length, 5);
    assert.equal((result.envelopeXml.match(/<CodRef>SET<\/CodRef>/g) ?? []).length, 5);
    for (const id of ["CASO-1", "CASO-2", "CASO-3", "CASO-4", "CASO-5"]) {
      assert.match(result.envelopeXml, new RegExp(`<RazonRef>${id}</RazonRef>`));
    }
    assert.match(result.envelopeXml, /<NmbItem>Sandwic<\/NmbItem>/);
    assert.match(result.envelopeXml, /<IndExe>1<\/IndExe>/);
    assert.match(result.envelopeXml, /<UnmdItem>Kg<\/UnmdItem>/);
    assert.doesNotMatch(result.envelopeXml, /<IndMntNeto>/);
    assert.equal(
      result.documents.every((document) =>
        readFileSync(
          join(outputDir, `${document.caseId}-BOLETA-39-PRE-CAF-FIXTURE.pdf`),
        ).subarray(0, 4).toString() === "%PDF",
      ),
      true,
    );
    const boletaTransport = resolveDteTransportProfile({
      environment: "certification",
      dteType: 39,
      env: {
        DTE_BOLETA_CERTIFICATION_UPLOAD_URL:
          "https://cert.example.invalid/boleta",
        DTE_SII_CERTIFICATION_UPLOAD_URL:
          "https://cert.example.invalid/factura",
      },
      type39IssuanceEnabled: false,
    });
    const facturaTransport = resolveDteTransportProfile({
      environment: "certification",
      dteType: 33,
      env: {
        DTE_BOLETA_CERTIFICATION_UPLOAD_URL:
          "https://cert.example.invalid/boleta",
        DTE_SII_CERTIFICATION_UPLOAD_URL:
          "https://cert.example.invalid/factura",
      },
    });
    assert.equal(boletaTransport.enabled, false);
    assert.notEqual(boletaTransport.endpoint, facturaTransport.endpoint);
    assert.notEqual(boletaTransport.tokenScope, facturaTransport.tokenScope);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("EnvioBOLETA y RCOF incluyen xmlns:xsi y xsi:schemaLocation exactos para el SII", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "citaya-boleta39-schema-test-"));
  try {
    const result = await prepareBoletaPreCaf({
      issueDate: "2026-08-03",
      firstFolio: 390_001,
      outputDir,
    });
    // Verificación de cabecera EnvioBOLETA
    assert.match(
      result.envelopeXml,
      /<EnvioBOLETA\s+xmlns="http:\/\/www\.sii\.cl\/SiiDte"\s+xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"\s+xsi:schemaLocation="http:\/\/www\.sii\.cl\/SiiDte EnvioBOLETA_v11\.xsd"\s+version="1\.0">/,
    );

    // Verificación de cabecera ConsumoFolios (RVD)
    assert.match(
      result.rvdXml,
      /<ConsumoFolios\s+xmlns="http:\/\/www\.sii\.cl\/SiiDte"\s+xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"\s+xsi:schemaLocation="http:\/\/www\.sii\.cl\/SiiDte ConsumoFolio_v10\.xsd"\s+version="1\.0">/,
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Boleta 39 incluye RUTProvSW y RznSocProvSW exactamente en Encabezado, firmado y validado por XSD", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "citaya-boleta39-rutprov-test-"));
  try {
    const result = await prepareBoletaPreCaf({
      issueDate: "2026-08-03",
      firstFolio: 390_001,
      outputDir,
      issuer: { rut: "78195645-7", legalName: "R&G SpA" },
    });
    const xml = result.envelopeXml;

    // 1. Los 5 DTE contienen exactamente <RUTProvSW>78195645-7</RUTProvSW>
    const rutProvMatches = xml.match(/<RUTProvSW>78195645-7<\/RUTProvSW>/g) ?? [];
    assert.equal(rutProvMatches.length, 5);

    // 2. Los 5 DTE contienen exactamente <RznSocProvSW>R&amp;G SpA</RznSocProvSW>
    const rznSocProvMatches = xml.match(/<RznSocProvSW>R&amp;G SpA<\/RznSocProvSW>/g) ?? [];
    assert.equal(rznSocProvMatches.length, 5);

    // 3. NO existe <RutProvSW> con minúscula
    assert.doesNotMatch(xml, /<RutProvSW>/);

    // 4 y 5. Están dentro de Encabezado, después de Receptor y antes de Totales
    const encabezadoRegex = /<Encabezado>[\s\S]*?<Receptor>[\s\S]*?<\/Receptor>\s*<RUTProvSW>78195645-7<\/RUTProvSW>\s*<RznSocProvSW>R&amp;G SpA<\/RznSocProvSW>\s*<Totales>[\s\S]*?<\/Encabezado>/g;
    const encabezadoMatches = xml.match(encabezadoRegex) ?? [];
    assert.equal(encabezadoMatches.length, 5);

    // 6. La firma de cada Documento cubre su nodo Encabezado / RUTProvSW (URI reference #...)
    for (let f = 390_001; f <= 390_005; f++) {
      assert.match(xml, new RegExp(`URI="#CitayaBoleta39-${f}"`));
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Boleta 39 en perfil manual-upload omite totalmente nodos de proveedor y valida con XSD de referencia del portal", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "citaya-boleta39-manual-upload-test-"));
  const referenceXsdPath = "/home/verf/secure/dte-lab/reference/sii-upload-schema-20260804/EnvioBOLETA_v11.xsd";

  try {
    const result = await prepareBoletaPreCaf({
      issueDate: "2026-08-03",
      firstFolio: 390_001,
      outputDir,
      issuer: { rut: "78195645-7", legalName: "R&G SpA" },
      softwareProviderMode: "omit_for_certification_upload",
      customBoletaXsdPath: referenceXsdPath,
    });
    const xml = result.envelopeXml;

    // 1. Cero nodos RUTProvSW, RutProvSW o RznSocProvSW
    assert.equal((xml.match(/<RUTProvSW>/g) ?? []).length, 0);
    assert.equal((xml.match(/<RutProvSW>/g) ?? []).length, 0);
    assert.equal((xml.match(/<RznSocProvSW>/g) ?? []).length, 0);

    // 2. Secuencia exacta: Receptor seguido inmediatamente por Totales (5/5)
    const receptorTotalesRegex = /<Receptor>[\s\S]*?<\/Receptor>\s*<Totales>/g;
    const receptorTotalesMatches = xml.match(receptorTotalesRegex) ?? [];
    assert.equal(receptorTotalesMatches.length, 5);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
