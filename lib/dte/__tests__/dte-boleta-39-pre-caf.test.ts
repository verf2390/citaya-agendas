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
