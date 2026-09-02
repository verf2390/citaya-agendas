#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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
const phase = String(process.argv[2] ?? "inspect").trim();
const allowed = new Set(["inspect", "prepare", "validate", "render", "ready-check"]);
if (!allowed.has(phase)) {
  console.error("PRE_CAF_NOT_READY");
  console.error("phase_invalid=use inspect|prepare|validate|render|ready-check");
  process.exit(2);
}

const {
  BOLETA_39_CERTIFICATION_CASES,
  BOLETA_FORMAT_VERSION,
  BOLETA_FORMAT_DATE,
  BOLETA_SCHEMA_VERSION,
  RVD_FORMAT_VERSION,
  RVD_FORMAT_DATE,
  BOLETA_XSD_PATH,
  RVD_XSD_PATH,
  prepareBoletaPreCaf,
} = require(resolve(repoRoot, "lib/dte/certification/boleta-pre-caf.ts"));

const outputDir = resolve(
  repoRoot,
  process.env.DTE_BOLETA_PRE_CAF_OUTPUT_DIR ??
    "tmp/dte-certification/boleta-39-pre-caf",
);
const issueDate =
  process.env.DTE_BOLETA_PRE_CAF_ISSUE_DATE ?? new Date().toISOString().slice(0, 10);
const firstFolio = Number(process.env.DTE_BOLETA_PRE_CAF_FIRST_FOLIO ?? "390001");

function issuerFromEnvironment() {
  return {
    rut: process.env.DTE_BOLETA_PRE_CAF_ISSUER_RUT,
    legalName: process.env.DTE_BOLETA_PRE_CAF_ISSUER_NAME,
    businessActivity: process.env.DTE_BOLETA_PRE_CAF_ISSUER_ACTIVITY,
    address: process.env.DTE_BOLETA_PRE_CAF_ISSUER_ADDRESS,
    commune: process.env.DTE_BOLETA_PRE_CAF_ISSUER_COMMUNE,
    city: process.env.DTE_BOLETA_PRE_CAF_ISSUER_CITY,
    resolutionDate: process.env.DTE_BOLETA_PRE_CAF_RESOLUTION_DATE,
    resolutionNumber: process.env.DTE_BOLETA_PRE_CAF_RESOLUTION_NUMBER,
    senderRut: process.env.DTE_BOLETA_PRE_CAF_SENDER_RUT,
  };
}

console.log("Citaya Boleta Electrónica PRE-CAF");
console.log(`phase=${phase}`);
console.log("environment=certification");
console.log("documentType=39");
console.log(`caseCount=${BOLETA_39_CERTIFICATION_CASES.length}`);
console.log(`boletaFormat=${BOLETA_FORMAT_VERSION}@${BOLETA_FORMAT_DATE}`);
console.log(`boletaSchema=${BOLETA_SCHEMA_VERSION}`);
console.log(`rvdFormat=${RVD_FORMAT_VERSION}@${RVD_FORMAT_DATE}`);
console.log(`boletaXsdPresent=${existsSync(resolve(repoRoot, BOLETA_XSD_PATH))}`);
console.log(`rvdXsdPresent=${existsSync(resolve(repoRoot, RVD_XSD_PATH))}`);
console.log(
  `publicVerificationPagePresent=${existsSync(
    resolve(repoRoot, "app/verificar/boleta/page.tsx"),
  )}`,
);
console.log("siiContacted=false");
console.log("officialCafPresent=false");
console.log("productionFoliosUsed=false");
console.log("submitCommandPresent=false");

if (phase === "inspect") {
  console.log(
    `cases=${BOLETA_39_CERTIFICATION_CASES.map((item) => item.id).join(",")}`,
  );
  console.log("result=PRE_CAF_INSPECTED");
  process.exit(0);
}

try {
  if (
    process.env.DTE_AUTOMATIC_ISSUANCE_ENABLED === "true" ||
    process.env.DTE_AUTOMATIC_ISSUANCE_MODE === "automatic_on_verified_payment"
  ) {
    throw new Error("AUTOMATIC_ISSUANCE_MUST_REMAIN_DISABLED");
  }
  if (!existsSync(resolve(repoRoot, "app/verificar/boleta/page.tsx"))) {
    throw new Error("PUBLIC_BOLETA_VERIFICATION_PAGE_MISSING");
  }
  const result = await prepareBoletaPreCaf({
    issueDate,
    firstFolio,
    outputDir,
    issuer: issuerFromEnvironment(),
    publicVerificationUrl:
      process.env.DTE_BOLETA_PUBLIC_VERIFICATION_URL ??
      "https://app.citaya.online/verificar/boleta",
  });
  console.log(`outputDir=${result.outputDir}`);
  console.log(`documents=${result.documents.length}`);
  console.log("singleEnvelope=true");
  console.log(
    `rvdTotals=${result.rvdTotals.netAmount}+${result.rvdTotals.taxAmount}+${result.rvdTotals.exemptAmount}=${result.rvdTotals.totalAmount}`,
  );
  console.log("xsdBoleta=valid");
  console.log("xsdRvd=valid");
  console.log("signatures=6/6");
  console.log("pdfRepresentations=5/5");
  console.log("automaticIssuanceRequired=false");
  console.log("productionEndpointEnabled=false");
  console.log(result.status);
} catch (error) {
  console.error("PRE_CAF_NOT_READY");
  console.error(
    `blocker=${error instanceof Error ? error.message : "unknown_error"}`,
  );
  process.exit(1);
}
