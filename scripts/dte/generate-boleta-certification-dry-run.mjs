#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function envValue(name) {
  return String(process.env[name] ?? "").trim();
}


function parseEnvFile(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadIssuerEnvFile() {
  const configuredPath = envValue("DTE_BOLETA_PRE_CAF_ENV_PATH") || "/home/verf/secure/dte-lab/issuer-certification.env";
  if (!existsSync(configuredPath)) return { loaded: false, path: configuredPath };

  const values = parseEnvFile(readFileSync(configuredPath, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) process.env[key] = value;
  }

  return { loaded: true, path: configuredPath };
}

function assertNoProductionRisk() {
  if (envValue("DTE_MODE") === "production") {
    console.error("blocked_production: DTE_MODE=production bloqueado para boletas certification dry-run.");
    process.exit(2);
  }
  if (envValue("DTE_SII_ENV") === "production") {
    console.error("blocked_production: DTE_SII_ENV=production bloqueado para boletas certification dry-run.");
    process.exit(2);
  }
}

function parsePositiveInteger(value, fallback, name) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser entero positivo`);
  }
  return parsed;
}

function optionalIssuerFromEnv() {
  return {
    tenantId: envValue("DTE_SMOKE_TENANT_ID") || undefined,
    rut: envValue("DTE_ISSUER_RUT") || envValue("DTE_CERTIFICATION_ISSUER_RUT") || undefined,
    legalName: envValue("DTE_ISSUER_RAZON_SOCIAL") || envValue("DTE_CERTIFICATION_ISSUER_LEGAL_NAME") || undefined,
    businessActivity: envValue("DTE_ISSUER_GIRO") || envValue("DTE_CERTIFICATION_ISSUER_GIRO") || undefined,
    businessActivityCode: envValue("DTE_CERTIFICATION_ISSUER_ACTECO") || undefined,
    address: envValue("DTE_ISSUER_DIRECCION") || envValue("DTE_CERTIFICATION_ISSUER_ADDRESS") || undefined,
    commune: envValue("DTE_ISSUER_COMUNA") || envValue("DTE_CERTIFICATION_ISSUER_COMMUNE") || undefined,
    city: envValue("DTE_ISSUER_CIUDAD") || envValue("DTE_CERTIFICATION_ISSUER_CITY") || undefined,
    region: envValue("DTE_ISSUER_REGION") || undefined,
    software: envValue("DTE_ISSUER_SOFTWARE") || undefined,
    url: envValue("DTE_ISSUER_URL") || undefined,
    representativeName: envValue("DTE_CERT_REPRESENTATIVE_NAME") || undefined,
    representativeRut: envValue("DTE_CERT_REPRESENTATIVE_RUT") || undefined,
    certificationEmail: envValue("DTE_CERTIFICATION_EMAIL") || undefined,
    siiResolutionDate: envValue("DTE_CERTIFICATION_RESOLUTION_DATE") || undefined,
    siiResolutionNumber: envValue("DTE_CERTIFICATION_RESOLUTION_NUMBER") || undefined,
  };
}

const issuerEnvFile = loadIssuerEnvFile();
assertNoProductionRisk();

const {
  buildBoletaCertificationDrafts,
  buildBoletaCertificationMetadata,
  buildBoletaCertificationSetEnvelopeXmlLab,
  buildRcofXmlLab,
  sha256Hex,
} = require(resolve(repoRoot, "lib/dte/certification/boleta-electronica-set.ts"));

const outputDir = resolve(
  repoRoot,
  envValue("DTE_BOLETA_CERTIFICATION_DRY_RUN_DIR") || "tmp/dte-certification/boleta-set-dry-run",
);
const issueDate = envValue("DTE_CERTIFICATION_ISSUE_DATE") || new Date().toISOString().slice(0, 10);
const firstFolio = parsePositiveInteger(
  envValue("DTE_BOLETA_CERTIFICATION_FIRST_FOLIO"),
  1,
  "DTE_BOLETA_CERTIFICATION_FIRST_FOLIO",
);
const issuerData = optionalIssuerFromEnv();
const drafts = buildBoletaCertificationDrafts({
  tenantId: envValue("DTE_SMOKE_TENANT_ID") || undefined,
  issuer: issuerData,
  issueDate,
  firstFolio,
});
const setEnvelope = buildBoletaCertificationSetEnvelopeXmlLab(drafts);

if (!setEnvelope.ok) {
  console.error(setEnvelope.error);
  process.exit(1);
}

const rcofXml = buildRcofXmlLab(drafts);
const metadata = buildBoletaCertificationMetadata(drafts, issuerData);
const setPath = resolve(outputDir, "boletas-tipo-39-set-dry-run.xml");
const rcofPath = resolve(outputDir, "rcof-boletas-tipo-39-dry-run.xml");
const metadataPath = resolve(outputDir, "metadata.json");
const cafPath = envValue("DTE_CAF_PATH");
const cafKeyPath = envValue("DTE_CAF_PRIVATE_KEY_PATH");
const cafPresent = Boolean(cafPath) && existsSync(cafPath);
const cafKeyPresent = Boolean(cafKeyPath) && existsSync(cafKeyPath);
const setSha256 = sha256Hex(setEnvelope.xml);
const rcofSha256 = sha256Hex(rcofXml);

mkdirSync(outputDir, { recursive: true });
writeFileSync(setPath, setEnvelope.xml, "latin1");
writeFileSync(`${setPath}.sha256`, `${setSha256}  ${setPath}
`, "utf8");
writeFileSync(rcofPath, rcofXml, "latin1");
writeFileSync(`${rcofPath}.sha256`, `${rcofSha256}  ${rcofPath}
`, "utf8");
writeFileSync(
  metadataPath,
  `${JSON.stringify(
    {
      ...metadata,
      issueDate,
      firstFolio,
      lastFolio: firstFolio + drafts.length - 1,
      outputDir,
      issuerEnvFileLoaded: issuerEnvFile.loaded,
      issuerEnvFilePath: issuerEnvFile.path,
      setEnvelopePath: setPath,
      rcofPath,
      setSha256,
      rcofSha256,
      cafPresent,
      cafKeyPresent,
      realTedBlocked: true,
      realSigningBlocked: true,
      submitBlocked: true,
      safeToDownloadCafWhen: [
        "Este dry-run genera el sobre unico tipo 39 y RCOF sin errores.",
        "Los datos reales del emisor estan configurados fuera del repo.",
        "Existe tiempo operativo para completar TED/FRMT/XMLDSig/XSD y submit certification dentro de 24 horas.",
        "La decision humana confirma bajar CAF de boletas en certification, no production.",
      ],
      commandsAfterCaf: [
        "export DTE_CAF_PATH=/home/verf/secure/dte-lab/caf/caf-certification.xml",
        "export DTE_CAF_PRIVATE_KEY_PATH=/home/verf/secure/dte-lab/private/caf-private-key.pem",
        "export DTE_CERT_PATH=/home/verf/secure/dte-lab/certs/certificado-digital.pem",
        "export DTE_PRIVATE_KEY_PATH=/home/verf/secure/dte-lab/private/certificado-private-key.pem",
        "npm run dte:external:check",
        "npm run dte:boleta:certification:dry-run",
        "DTE_MODE=certification DTE_SII_ENV=certification npm run dte:certification:xml",
        "npm run dte:certification:validate-xml",
        "npm run dte:certification:readiness",
      ],
      warnings: [
        ...setEnvelope.warnings,
        metadata.issuerDataReady
          ? "Datos reales del emisor configurados para PRE-CAF."
          : "NO BAJAR CAF: faltan datos reales del emisor o hay placeholders/demo.",
        "CAF no se descarga en este paso.",
        "No se contacta SII y no se simula track_id.",
        "Si CAF ya existe, este script igual mantiene TED/firma/submit bloqueados por diseno dry-run.",
      ],
    },
    null,
    2,
  )}
`,
  "utf8",
);

console.log("Citaya Boleta Electronica Certification Dry Run");
console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
console.log("documentType=boleta_afecta");
console.log("siiDocumentTypeCode=39");
console.log(`caseCount=${drafts.length}`);
console.log(`issueDate=${issueDate}`);
console.log(`folioRange=${firstFolio}-${firstFolio + drafts.length - 1}`);
console.log(`setEnvelope=${setPath}`);
console.log(`rcof=${rcofPath}`);
console.log(`metadata=${metadataPath}`);
console.log(`setSha256=${setSha256.slice(0, 16)}`);
console.log(`rcofSha256=${rcofSha256.slice(0, 16)}`);
console.log(`issuerEnvFileLoaded=${issuerEnvFile.loaded}`);
console.log(`issuerDataReady=${metadata.issuerDataReady}`);
console.log(`cafPresent=${cafPresent}`);
console.log(`cafKeyPresent=${cafKeyPresent}`);
console.log("canGenerateNow=fixtures,set-envelope-dry-run,rcof-dry-run,hashes,metadata");
console.log("blockedUntilCaf=real TED,FRMT,XMLDSig,XSD final,submit");
console.log("sii_contact=no");
console.log("track_id_simulado=NO");
console.log("submitBlocked=true");
console.log("production=false");
if (!metadata.issuerDataReady) {
  console.log("preCafStatus=NO BAJAR CAF");
  console.log("preCafReason=datos reales del emisor incompletos o placeholders detectados");
}
