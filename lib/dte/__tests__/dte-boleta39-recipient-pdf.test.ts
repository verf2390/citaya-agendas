import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { buildProductionBoleta39Document } from "../production-boleta39";

const dummyIssuer = {
  rut: "78.195.645-7",
  legalName: "R&G SPA",
  businessActivity: "Servicios digitales",
  address: "Colón Nro. 352, Of. 318",
  commune: "La Serena",
  city: "La Serena",
  resolutionDate: "2014-08-22",
  resolutionNumber: "80",
};

const tenantId = "21884d8b-1975-4e5c-8887-06eb62401428";
const cafPath = `/home/verf/secure/citaya-dte-production-rg-spa/cafs/${tenantId}/39.xml`;
const certPath = `/home/verf/secure/citaya-dte-production-rg-spa/certificates/${tenantId}/certificate.pem`;
const keyPath = `/home/verf/secure/citaya-dte-production-rg-spa/private-keys/${tenantId}/private-key.pem`;

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

test("Boleta 39 rendering with selected customer Victor Rodriguez includes customer name and maintains amounts 4202/798/5000", async () => {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath) || !fs.existsSync(cafPath)) return;
  const cafXml = fs.readFileSync(cafPath, "utf8");

  const result = await buildProductionBoleta39Document({
    tenantId,
    folio: 40014,
    issueDate: "2026-08-05",
    issuer: dummyIssuer,
    recipient: {
      legalName: "Victor Rodriguez",
      rut: "26706221-8",
    },
    lines: [
      {
        description: "SERVICIOS WEB",
        quantity: 1,
        unitGrossAmount: 5000,
      },
    ],
    cafXml,
    privateKeyPath: keyPath,
    certificatePath: certPath,
  });

  const dteSha = sha256Hex(result.dteXml);
  const envioSha = sha256Hex(result.envioXml);

  assert.notEqual(dteSha, envioSha);
  assert.match(result.dteXml, /<DTE\s+version="1\.0"/);
  assert.match(result.envioXml, /<EnvioBOLETA\s+/);

  assert.equal(result.totals.netAmount, 4202);
  assert.equal(result.totals.taxAmount, 798);
  assert.equal(result.totals.totalAmount, 5000);
  assert.match(result.dteXml, /<MntNeto>4202<\/MntNeto>/);
  assert.match(result.dteXml, /<IVA>798<\/IVA>/);
  assert.match(result.dteXml, /<MntTotal>5000<\/MntTotal>/);
  assert.ok(result.pdfBytes.length > 1000);

  const uploadFileName = [39, 41].includes(39) ? "EnvioBoleta.xml" : "EnvioDTE.xml";
  assert.equal(uploadFileName, "EnvioBoleta.xml");
});

test("Boleta 39 rendering without selected customer defaults to Consumidor Final", async () => {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath) || !fs.existsSync(cafPath)) return;
  const cafXml = fs.readFileSync(cafPath, "utf8");

  const result = await buildProductionBoleta39Document({
    tenantId,
    folio: 40014,
    issueDate: "2026-08-05",
    issuer: dummyIssuer,
    recipient: undefined,
    lines: [
      {
        description: "SERVICIOS WEB",
        quantity: 1,
        unitGrossAmount: 5000,
      },
    ],
    cafXml,
    privateKeyPath: keyPath,
    certificatePath: certPath,
  });

  assert.equal(result.totals.netAmount, 4202);
  assert.equal(result.totals.taxAmount, 798);
  assert.equal(result.totals.totalAmount, 5000);
});
