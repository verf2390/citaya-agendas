#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { require } from "./dte-ts-loader.mjs";

const { buildFacturaCertificationDocuments } = require("../../lib/dte/certification/factura-electronica-set.ts");
const { buildSalesBookModel } = require("../../lib/dte/certification/sales-book.ts");
const { buildPurchaseBookModel } = require("../../lib/dte/certification/purchase-book.ts");
const { validatePreCafExternalData } = require("../../lib/dte/certification/pre-caf-external-contract.ts");
const { loadFacturaPreCafInputFromPath } = require("../../lib/dte/certification/pre-caf-input-loader.ts");

const missing = new Set();
const invalid = new Set();
function addMissing(items) { for (const item of items) missing.add(item); }
function addInvalid(items) { for (const item of items) invalid.add(item); }
function envValue(name) { return String(process.env[name] ?? "").trim(); }
function enabled(name) { return /^(1|true|yes|si|sí)$/i.test(envValue(name)); }

function textCorrectionForBuilder(external) {
  return {
    previousBusinessActivity: String(external.textCorrection?.giroAnterior ?? ""),
    correctedBusinessActivity: String(external.textCorrection?.giroCorregido ?? ""),
  };
}

function salesDetailsFromExternal(external) {
  const receiverByCase = {
    "4959698-1": external.receivers?.receiver1,
    "4959698-2": external.receivers?.receiver2,
    "4959698-3": external.receivers?.receiver3,
    "4959698-4": external.receivers?.receiver4,
    "4959698-5": external.receivers?.receiver1,
    "4959698-6": external.receivers?.receiver2,
    "4959698-7": external.receivers?.receiver3,
    "4959698-8": external.receivers?.receiver1,
  };
  return Object.fromEntries(Object.entries(receiverByCase).map(([caseId, receiver], index) => [caseId, {
    folio: index + 1,
    recipientRut: String(receiver?.rut ?? ""),
    recipientName: String(receiver?.razonSocial ?? ""),
  }]));
}

function purchaseProvidersFromExternal(external) {
  return Object.fromEntries(Object.entries(external.purchaseProviders ?? {}).map(([caseId, provider]) => [caseId, {
    rut: String(provider?.rut ?? ""),
    name: String(provider?.razonSocial ?? ""),
  }]));
}

function runBooksXsdCheck() {
  const result = spawnSync(process.execPath, ["scripts/dte/books-xsd-check.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOCKER_HOST: process.env.DOCKER_HOST,
      DTE_BOOKS_XSD_DIR: process.env.DTE_BOOKS_XSD_DIR,
    },
  });
  return result.status === 0 && /schemaIntegrity=ok/.test(result.stdout) && /schemaCompile=ok/.test(result.stdout) && /salesBook=valid/.test(result.stdout) && /purchaseBook=valid/.test(result.stdout);
}

function configuredPathExists(name) {
  const value = envValue(name);
  return Boolean(value) || (value ? existsSync(value) : false);
}

function deriveOperationalConfirmations() {
  const cafVars = ["DTE_CAF_PATH", "DTE_CAF_PRIVATE_KEY_PATH", "DTE_FACTURA_CAF_PATH", "DTE_FACTURA_CAF_PRIVATE_KEY_PATH"];
  const folioVars = ["DTE_CERTIFICATION_FOLIO", "DTE_FACTURA_CERTIFICATION_FIRST_FOLIO", "DTE_FOLIO_RESERVATION_PATH", "DTE_RESERVED_FOLIOS_PATH"];
  const trackVars = ["DTE_TRACK_ID", "DTE_SII_TRACK_ID", "DTE_SUBMISSION_TRACK_ID", "DTE_SIMULATED_TRACK_ID"];
  const checks = {
    cafAbsentConfirmed: cafVars.every((name) => !configuredPathExists(name)),
    foliosNotReservedConfirmed: folioVars.every((name) => !envValue(name)),
    submitDisabledConfirmed: !enabled("DTE_SII_ENABLE_SUBMIT"),
    trackIdSimulationAbsentConfirmed: trackVars.every((name) => !envValue(name)) && !enabled("DTE_TRACK_ID_SIMULATED") && !enabled("DTE_SIMULATE_TRACK_ID"),
  };
  for (const [name, ok] of Object.entries(checks)) if (!ok) invalid.add(name);
}

if (process.env.DTE_SII_ENV !== "certification") invalid.add("DTE_SII_ENV");
if (process.env.DTE_SII_ENV === "production" || process.env.DTE_MODE === "production" || process.env.NODE_ENV === "production-sii") invalid.add("productionBlocked");

const loaded = loadFacturaPreCafInputFromPath({
  inputPath: process.env.DTE_FACTURA_PRE_CAF_INPUT_PATH,
  repoRoot: process.cwd(),
  env: process.env,
});
if (!loaded.ok) {
  addMissing(loaded.missingFields);
  addInvalid(loaded.invalidFields);
} else {
  const externalValidation = validatePreCafExternalData(loaded.input);
  addMissing(externalValidation.missingFields);
  addInvalid(externalValidation.invalidFields);

  if (externalValidation.ok) {
    const textCorrection = textCorrectionForBuilder(loaded.input);
    try {
      buildFacturaCertificationDocuments({ issueDate: loaded.issueDate, taxPeriod: loaded.taxPeriod, textCorrection });
    } catch { invalid.add("basicSet.calculation"); }

    try {
      buildSalesBookModel({
        issueDate: loaded.issueDate,
        taxPeriod: loaded.taxPeriod,
        externalData: {
          rutEmisorLibro: loaded.input.issuer?.rutEmisor,
          rutEnvia: loaded.input.issuer?.rutEnvia,
          fchResol: loaded.input.issuer?.fechaResolucion,
          nroResol: loaded.input.issuer?.numeroResolucion,
        },
        textCorrection,
        details: salesDetailsFromExternal(loaded.input),
      });
    } catch { invalid.add("salesBook.calculation"); }

    try {
      buildPurchaseBookModel({
        externalData: {
          rutEmisorLibro: loaded.input.issuer?.rutEmisor,
          rutEnvia: loaded.input.issuer?.rutEnvia,
          periodoTributario: loaded.taxPeriod,
          fchResol: loaded.input.issuer?.fechaResolucion,
          nroResol: loaded.input.issuer?.numeroResolucion,
        },
        providers: purchaseProvidersFromExternal(loaded.input),
        salesBookPeriod: loaded.taxPeriod,
      });
    } catch { invalid.add("purchaseBook.calculation"); }
  }
}

deriveOperationalConfirmations();

if (missing.size === 0 && invalid.size === 0) {
  if (!runBooksXsdCheck()) invalid.add("booksXsdValidated");
} else {
  missing.add("booksXsdValidated");
}

const status = missing.size === 0 && invalid.size === 0 ? "PRE_CAF_OFFLINE_READY" : "PRE_CAF_NOT_READY";
console.log(`status=${status}`);
console.log(`missing=${[...missing].sort().join(",")}`);
console.log(`invalid=${[...invalid].sort().join(",")}`);
console.log("readyToDownloadCaf=false");
process.exit(0);
