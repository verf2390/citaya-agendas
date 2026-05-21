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

function envValue(name) {
  return String(process.env[name] ?? "").trim();
}

function boolLabel(value) {
  return value ? "si" : "no";
}

function assertNoProductionRisk() {
  if (envValue("DTE_MODE") === "production") {
    console.error("blocked_production: DTE_MODE=production bloqueado para generar XML certification.");
    process.exit(2);
  }
  if (envValue("DTE_SII_ENV") === "production") {
    console.error("blocked_production: DTE_SII_ENV=production bloqueado para generar XML certification.");
    process.exit(2);
  }
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser entero positivo`);
  }
  return parsed;
}

assertNoProductionRisk();

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
const { getSiiDteTypeCode, isSupportedDteDocumentType } = require(resolve(
  repoRoot,
  "lib/dte/dte-types.ts",
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

const defaultDraft = {
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
    legalName: "Cliente Demo Certification",
    businessActivity: "Persona natural",
    address: "Direccion demo sin datos reales",
    commune: "La Serena",
    city: "La Serena",
    email: "cliente.demo@example.com",
  },
  lines: [
    {
      name: "Servicio demo Citaya certification",
      description: "Detalle LAB certification sin validez tributaria",
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

let draft = defaultDraft;

function buildCertificationDraftFromCaf(caf) {
  const requestedType = envValue("DTE_CERTIFICATION_DOC_TYPE") || caf.documentType;
  if (!isSupportedDteDocumentType(requestedType)) {
    throw new Error(`DTE_CERTIFICATION_DOC_TYPE no soportado: ${requestedType}`);
  }
  const folio = envValue("DTE_CERTIFICATION_FOLIO")
    ? parsePositiveInteger(envValue("DTE_CERTIFICATION_FOLIO"), "DTE_CERTIFICATION_FOLIO")
    : caf.rangeFrom;
  const issueDate = envValue("DTE_CERTIFICATION_ISSUE_DATE") || new Date().toISOString().slice(0, 10);
  const tenantId = envValue("DTE_SMOKE_TENANT_ID") || caf.tenantId || defaultDraft.tenantId;

  return {
    ...defaultDraft,
    tenantId,
    documentType: requestedType,
    folio,
    issueDate,
    issuer: {
      ...defaultDraft.issuer,
      tenantId,
      rut: caf.issuerRut,
      legalName: caf.issuerLegalName || defaultDraft.issuer.legalName,
      businessActivity: envValue("DTE_CERTIFICATION_ISSUER_GIRO") || defaultDraft.issuer.businessActivity,
      businessActivityCode: envValue("DTE_CERTIFICATION_ISSUER_ACTECO") || defaultDraft.issuer.businessActivityCode,
      address: envValue("DTE_CERTIFICATION_ISSUER_ADDRESS") || defaultDraft.issuer.address,
      commune: envValue("DTE_CERTIFICATION_ISSUER_COMMUNE") || defaultDraft.issuer.commune,
      city: envValue("DTE_CERTIFICATION_ISSUER_CITY") || defaultDraft.issuer.city,
      siiResolutionDate: envValue("DTE_CERTIFICATION_RESOLUTION_DATE") || defaultDraft.issuer.siiResolutionDate,
      siiResolutionNumber: envValue("DTE_CERTIFICATION_RESOLUTION_NUMBER") || defaultDraft.issuer.siiResolutionNumber,
      dteEnvironment: "certification",
    },
  };
}


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
  const tenantId = envValue("DTE_SMOKE_TENANT_ID") || defaultDraft.tenantId;
  const caf = loadCafRealControlledFromEnv(tenantId);
  draft = buildCertificationDraftFromCaf(caf);
  validateCafForDraftOrThrow(caf, draft);
  const documentTypeCode = getSiiDteTypeCode(draft.documentType);
  const documentId = `CitayaDocLab-${documentTypeCode}-${draft.folio}`;
  const setDteId = `CitayaDteLab-${draft.tenantId}-${draft.folio}`;
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
    console.error("pending_real_certification: faltan archivos externos para XML certification controlado.");
    console.error(`missing_external_files=${missing.join(",")}`);
    console.error("No se genera XML certification real/controlado y no se contacta SII.");
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
    ? resolve(repoRoot, envValue("DTE_CERTIFICATION_OUTPUT_PATH") || "tmp/dte-certification/certification-envio-dte.xml")
    : resolve(repoRoot, "docs/dte-sii/samples/lab-envio-dte.xml");
const xmlSha256 = createHash("sha256").update(result.xml).digest("hex");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, result.xml, "latin1");
if (mode === "certification") {
  writeFileSync(`${outputPath}.sha256`, `${xmlSha256}  ${outputPath}\n`, "utf8");
  writeFileSync(
    `${outputPath}.metadata.json`,
    `${JSON.stringify(
      {
        globalStatus: "LAB / PENDIENTE / NO PRODUCTIVO",
        mode,
        outputPath,
        xmlSha256,
        folio: draft.folio,
        documentType: draft.documentType,
        xmlSignatureStatuses: options.xmlSignatureStatuses ?? [],
        xmlSignatureVerification: options.xmlSignatureVerification ?? [],
        warnings: [...result.warnings, ...(options.warnings ?? [])],
        siiContact: false,
        trackIdSimulated: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

console.log("Citaya DTE XML Generator");
console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
console.log(`output=${outputPath}`);
console.log(`mode=${mode}`);
console.log(`xsd_target=docs/dte-sii/xsd/EnvioDTE_v10.xsd`);
console.log(`xml_sha256=${xmlSha256.slice(0, 16)}`);
console.log(`sii_contact=no`);
console.log(`track_id_simulado=NO`);
console.log(`certification_folio=${draft.folio}`);
console.log(`certification_doc_type=${draft.documentType}`);
console.log(`external_files_required=${boolLabel(mode === "certification")}`);
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
