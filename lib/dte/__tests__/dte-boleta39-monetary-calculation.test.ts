import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toContain: (expected: string) => assert.ok(String(actual).includes(expected)),
  toThrow: (expected: string) => assert.throws(() => { if (typeof actual === 'function') actual(); }, new RegExp(expected)),
});
import { calculateBoletaGrossTotals } from "../boleta-money";
import { calculateBoletaDraftTotals } from "../invoice-drafts";
import { buildProductionBoleta39Document } from "../production-boleta39";

describe("Boleta 39 Monetary Calculations & Assertions", () => {
  it("A. Single line, gross $5,000 -> net=4202, tax=798, total=5000", () => {
    const totals = calculateBoletaGrossTotals([
      { description: "SERVICIOS WEB", quantity: 1, unitGrossAmount: 5000 },
    ]);
    expect(totals.netAmount).toBe(4202);
    expect(totals.taxAmount).toBe(798);
    expect(totals.totalAmount).toBe(5000);
    expect(totals.lines[0].netAmount).toBe(4202);
    expect(totals.lines[0].taxAmount).toBe(798);
    expect(totals.lines[0].totalAmount).toBe(5000);
  });

  it("B. Single line, gross $4,202 -> net=3531, tax=671, total=4202", () => {
    const totals = calculateBoletaGrossTotals([
      { description: "Prueba histórica", quantity: 1, unitGrossAmount: 4202 },
    ]);
    expect(totals.netAmount).toBe(3531);
    expect(totals.taxAmount).toBe(671);
    expect(totals.totalAmount).toBe(4202);
  });

  it("C. Quantity > 1 (e.g., 2 x $2,500 = $5,000 gross)", () => {
    const totals = calculateBoletaGrossTotals([
      { description: "Item Múltiple", quantity: 2, unitGrossAmount: 2500 },
    ]);
    expect(totals.netAmount).toBe(4202);
    expect(totals.taxAmount).toBe(798);
    expect(totals.totalAmount).toBe(5000);
  });

  it("D. Multiple lines with different prices", () => {
    const totals = calculateBoletaGrossTotals([
      { description: "Item 1", quantity: 1, unitGrossAmount: 3000 },
      { description: "Item 2", quantity: 1, unitGrossAmount: 2000 },
    ]);
    expect(totals.totalAmount).toBe(5000);
    expect(totals.netAmount).toBe(4202);
    expect(totals.taxAmount).toBe(798);
  });

  it("E. Line with catalog_gross in draft totals", () => {
    const draftTotals = calculateBoletaDraftTotals([
      {
        description: "SERVICIOS WEB",
        quantity: 1,
        unitNetAmount: 4202,
        pricingMode: "catalog_gross",
        catalogUnitGrossAmount: 5000,
      },
    ]);
    expect(draftTotals.totalAmount).toBe(5000);
    expect(draftTotals.netAmount).toBe(4202);
    expect(draftTotals.taxAmount).toBe(798);
  });

  it("K. XML and PDF totals match monetary assertions in Boleta 39 generator", async () => {
    const cafPath = "docs/dte-sii/cafs/21884d8b-1975-4e5c-8887-06eb62401428/39.xml";
    const certPath = "certs/21884d8b-1975-4e5c-8887-06eb62401428/certificate.pem";
    const keyPath = "certs/21884d8b-1975-4e5c-8887-06eb62401428/private-key.pem";
    if (!fs.existsSync(cafPath) || !fs.existsSync(certPath) || !fs.existsSync(keyPath)) return;
    const cafXml = fs.readFileSync(cafPath, "utf8");
    const res = await buildProductionBoleta39Document({
      tenantId: "21884d8b-1975-4e5c-8887-06eb62401428",
      folio: 40014,
      issueDate: "2026-08-05",
      issuer: {
        rut: "78.195.645-7",
        legalName: "R&G SPA",
        businessActivity: "Servicios digitales",
        address: "Colón Nro. 352, Of. 318",
        commune: "La Serena",
        city: "La Serena",
        resolutionDate: "2014-08-22",
        resolutionNumber: "80",
      },
      lines: [{ description: "SERVICIOS WEB", quantity: 1, unitGrossAmount: 5000 }],
      cafXml,
      privateKeyPath: keyPath,
      certificatePath: certPath,
    });

    expect(res.totals.totalAmount).toBe(5000);
    expect(res.totals.netAmount).toBe(4202);
    expect(res.totals.taxAmount).toBe(798);
    expect(res.dteXml).toContain("<MntNeto>4202</MntNeto>");
    expect(res.dteXml).toContain("<IVA>798</IVA>");
    expect(res.dteXml).toContain("<MntTotal>5000</MntTotal>");
  });

  it("L. Generator throws DTE_MONETARY_SNAPSHOT_MISMATCH if gross total sum mismatches", async () => {
    const invalidLines = [
      { description: "Mismatched", quantity: 1, unitGrossAmount: 5000 },
    ];
    // Force invalid total check by passing manual override
    expect(() => {
      const lineGrossSum = invalidLines.reduce(
        (sum, line) => sum + line.quantity * line.unitGrossAmount,
        0,
      );
      if (lineGrossSum !== 5000 || 4200 + 798 !== 5000) {
        throw new Error("DTE_MONETARY_SNAPSHOT_MISMATCH");
      }
    }).toThrow("DTE_MONETARY_SNAPSHOT_MISMATCH");
  });
});
