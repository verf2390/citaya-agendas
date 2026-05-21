#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createHash } = require("node:crypto");

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
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = modeArg?.split("=")[1] ?? "lab";
const allowedModes = new Set(["lab", "xsd-structure", "certification"]);

if (!allowedModes.has(mode)) {
  console.error("Invalid mode. Use --mode=lab|xsd-structure|certification");
  process.exit(2);
}

const { buildFacturaXmlLab } = require(resolve(
  repoRoot,
  "lib/dte/xml/build-factura.ts",
));
const { buildTedControlled } = require(resolve(
  repoRoot,
  "lib/dte/caf/ted-builder.ts",
));
const { signFrmtControlled } = require(resolve(
  repoRoot,
  "lib/dte/caf/frmt-signature.ts",
));
const {
  loadCafRealControlledFromEnv,
  validateCafForDraftOrThrow,
} = require(resolve(repoRoot, "lib/dte/caf/parse-caf.real.ts"));
const { buildSyntheticXmlDsigForXsd } = require(resolve(
  repoRoot,
  "lib/dte/signing/xml-dsig.structure.ts",
));
const {
  buildXmlDsigControlled,
  getRealXmlSigningConfigFromEnv,
} = require(resolve(repoRoot, "lib/dte/signing/sign-xml.real.ts"));

const draft = {
  tenantId: "tenant-lab-citaya",
  issueMode: "citaya_own_dte",
  documentType: "factura_afecta",
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
      unitPrice: 10000,
      amount: 10000,
    },
  ],
  netAmount: 10000,
  taxAmount: 1900,
  exemptAmount: 0,
  totalAmount: 11900,
};

function buildSyntheticCafXml() {
  return [
    '<CAF version="1.0">',
    "  <DA>",
    "    <RE>76123456-0</RE>",
    "    <RS>Empresa Demo Citaya SpA</RS>",
    "    <TD>33</TD>",
    "    <RNG>",
    "      <D>1001</D>",
    "      <H>1010</H>",
    "    </RNG>",
    "    <FA>2026-05-13</FA>",
    "    <RSAPK>",
    "      <M>AA==</M>",
    "      <E>AQAB</E>",
    "    </RSAPK>",
    "    <IDK>1</IDK>",
    "  </DA>",
    '  <FRMA algoritmo="SHA1withRSA">AA==</FRMA>',
    "</CAF>",
  ].join("\n");
}

function buildSyntheticFrmtXml(ddXml) {
  const value = createHash("sha1")
    .update(`${ddXml}:LAB-XSD-STRUCTURE`)
    .digest("base64");
  return `<FRMT algoritmo="SHA1withRSA">${value}</FRMT>`;
}

function buildXsdStructureOptions() {
  const documentTypeCode = 33;
  const documentId = `CitayaDocLab-${documentTypeCode}-${draft.folio}`;
  const setDteId = `CitayaDteLab-${draft.tenantId}-${draft.folio}`;
  const cafXml = buildSyntheticCafXml();
  const tedWithoutFrmt = buildTedControlled({
    issuerRut: "76123456-0",
    documentTypeCode,
    folio: draft.folio,
    issueDate: draft.issueDate,
    recipientRut: "11111111-1",
    recipientLegalName: "Cliente Demo",
    totalAmount: draft.totalAmount,
    firstItemName: draft.lines[0].name,
    cafXml,
    timestamp: "2026-05-13T00:00:00",
  });
  const ted = buildTedControlled({
    issuerRut: "76123456-0",
    documentTypeCode,
    folio: draft.folio,
    issueDate: draft.issueDate,
    recipientRut: "11111111-1",
    recipientLegalName: "Cliente Demo",
    totalAmount: draft.totalAmount,
    firstItemName: draft.lines[0].name,
    cafXml,
    timestamp: "2026-05-13T00:00:00",
    frmtXml: buildSyntheticFrmtXml(tedWithoutFrmt.ddXml),
    frmtStatus: "synthetic_lab",
  });
  const documentSignature = buildSyntheticXmlDsigForXsd({
    referenceUri: documentId,
    signedXmlFragment: ted.tedXml,
    mode: "xsd-structure",
    signatureId: "LAB-XSD-DTE-SIGNATURE",
  });
  const envioSignature = buildSyntheticXmlDsigForXsd({
    referenceUri: setDteId,
    signedXmlFragment: `${setDteId}:${documentId}`,
    mode: "xsd-structure",
    signatureId: "LAB-XSD-ENVIO-SIGNATURE",
  });

  return {
    mode: "xsd-structure",
    tedXml: ted.tedXml,
    documentSignedAt: "2026-05-13T00:00:00",
    documentSignatureXml: documentSignature.signatureXml,
    envioSignatureXml: envioSignature.signatureXml,
    warnings: [
      ...ted.warnings,
      ...documentSignature.warnings,
      ...envioSignature.warnings,
    ],
  };
}

function buildCertificationOptions() {
  const documentTypeCode = 33;
  const documentId = `CitayaDocLab-${documentTypeCode}-${draft.folio}`;
  const setDteId = `CitayaDteLab-${draft.tenantId}-${draft.folio}`;
  const caf = loadCafRealControlledFromEnv(draft.tenantId);
  validateCafForDraftOrThrow(caf, draft);
  const tedWithoutFrmt = buildTedControlled({
    issuerRut: caf.issuerRut,
    documentTypeCode,
    folio: draft.folio,
    issueDate: draft.issueDate,
    recipientRut: "11111111-1",
    recipientLegalName: "Cliente Demo",
    totalAmount: draft.totalAmount,
    firstItemName: draft.lines[0].name,
    cafXml: caf.cafXml,
    timestamp: "2026-05-13T00:00:00",
  });
  const frmt = signFrmtControlled({
    ddXml: tedWithoutFrmt.ddXml,
    privateKeyPath: process.env.DTE_CAF_PRIVATE_KEY_PATH,
    mode: "certification",
  });

  if (!frmt.ok) {
    throw new Error(`FRMT certification failed. Missing: ${frmt.missing.join(", ")}`);
  }

  const ted = buildTedControlled({
    issuerRut: caf.issuerRut,
    documentTypeCode,
    folio: draft.folio,
    issueDate: draft.issueDate,
    recipientRut: "11111111-1",
    recipientLegalName: "Cliente Demo",
    totalAmount: draft.totalAmount,
    firstItemName: draft.lines[0].name,
    cafXml: caf.cafXml,
    timestamp: "2026-05-13T00:00:00",
    frmtXml: frmt.frmtXml,
    frmtStatus: "real_controlled",
  });
  const documentSigningConfig = getRealXmlSigningConfigFromEnv(
    draft.tenantId,
    documentId,
  );
  documentSigningConfig.mode = "certification";
  const envioSigningConfig = getRealXmlSigningConfigFromEnv(
    draft.tenantId,
    setDteId,
  );
  envioSigningConfig.mode = "certification";
  const documentSignature = buildXmlDsigControlled(
    {
      referenceUri: documentId,
      signedXmlFragment: ted.tedXml,
      mode: "certification",
      signatureId: "CERTIFICATION-DTE-SIGNATURE",
    },
    documentSigningConfig,
  );
  const envioSignature = buildXmlDsigControlled(
    {
      referenceUri: setDteId,
      signedXmlFragment: `${setDteId}:${documentId}:${ted.tedXml}`,
      mode: "certification",
      signatureId: "CERTIFICATION-ENVIO-SIGNATURE",
    },
    envioSigningConfig,
  );

  return {
    mode: "certification",
    tedXml: ted.tedXml,
    documentSignedAt: "2026-05-13T00:00:00",
    documentSignatureXml: documentSignature.signatureXml,
    envioSignatureXml: envioSignature.signatureXml,
    xmlSignatureStatuses: [
      `document=${documentSignature.xmlSignatureStatus ?? "unknown"}`,
      `envio=${envioSignature.xmlSignatureStatus ?? "unknown"}`,
    ],
    xmlSignatureVerification: [
      `document=${documentSignature.verification?.ok ? "ok" : "failed"}`,
      `envio=${envioSignature.verification?.ok ? "ok" : "failed"}`,
    ],
    warnings: [
      ...ted.warnings,
      ...frmt.warnings,
      ...documentSignature.warnings,
      ...envioSignature.warnings,
      "Certification local no equivale a aprobacion SII ni envio a SII.",
    ],
  };
}

if (mode === "certification") {
  const missing = [
    "DTE_CAF_PATH",
    "DTE_CAF_PRIVATE_KEY_PATH",
    "DTE_CERT_PATH",
    "DTE_PRIVATE_KEY_PATH",
  ].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `Certification mode requires secrets outside repo. Missing: ${missing.join(", ")}`,
    );
    process.exit(3);
  }
}

let options;
try {
  options =
    mode === "xsd-structure"
      ? buildXsdStructureOptions()
      : mode === "certification"
        ? buildCertificationOptions()
        : { mode };
} catch (error) {
  console.error(
    error instanceof Error
      ? `Certification generation failed: ${error.message}`
      : "Certification generation failed",
  );
  process.exit(3);
}
const result = buildFacturaXmlLab(draft, options);

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

const outputPath =
  mode === "certification"
    ? resolve(repoRoot, "tmp/dte-certification/certification-envio-dte.xml")
    : resolve(repoRoot, "docs/dte-sii/samples/lab-envio-dte.xml");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, result.xml, "latin1");

console.log(outputPath);
console.log(`mode=${mode}`);
console.log(`warnings=${result.warnings.length}`);
for (const warning of result.warnings) {
  console.log(`- ${warning}`);
}
for (const status of options.xmlSignatureStatuses ?? []) {
  console.log(`xmlSignatureStatus=${status}`);
}
for (const verification of options.xmlSignatureVerification ?? []) {
  console.log(`xmlSignatureVerification=${verification}`);
}
for (const warning of options.warnings ?? []) {
  console.log(`- ${warning}`);
}
