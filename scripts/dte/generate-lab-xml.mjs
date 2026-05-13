#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  });

  module._compile(output.outputText, filename);
};

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const outputPath = resolve(repoRoot, "docs/dte-sii/samples/lab-envio-dte.xml");
const { buildBoletaXmlLab } = require(resolve(
  repoRoot,
  "lib/dte/xml/build-boleta.ts",
));

const draft = {
  tenantId: "tenant-lab-citaya",
  issueMode: "citaya_own_dte",
  documentType: "boleta_afecta",
  status: "draft",
  folio: 1001,
  issueDate: "2026-05-13",
  issuer: {
    tenantId: "tenant-lab-citaya",
    rut: "76.123.456-0",
    legalName: "Empresa Demo Citaya SpA",
    businessActivity: "Servicios profesionales demo",
    businessActivityCode: "960909",
    address: "Av. Laboratorio 123",
    commune: "La Serena",
    city: "La Serena",
    siiResolutionDate: "2006-01-01",
    siiResolutionNumber: "0",
    dteEnvironment: "lab",
  },
  recipient: {
    rut: "11.111.111-1",
    legalName: "Cliente Demo",
    businessActivity: "Persona natural",
    address: "Sin direccion",
    commune: "La Serena",
    city: "La Serena",
    email: "cliente.demo@example.com",
  },
  lines: [
    {
      name: "Reserva demo Citaya",
      description: "Detalle LAB sin validez tributaria",
      quantity: 1,
      unitPrice: 11900,
      amount: 11900,
    },
  ],
  netAmount: 10000,
  taxAmount: 1900,
  exemptAmount: 0,
  totalAmount: 11900,
};

const result = buildBoletaXmlLab(draft);

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, result.xml, "latin1");

console.log(outputPath);
console.log(`warnings=${result.warnings.length}`);
for (const warning of result.warnings) {
  console.log(`- ${warning}`);
}
