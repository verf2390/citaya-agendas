#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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
const envPath = resolve(repoRoot, ".env.dte-lab");
const secureRoot = "/home/verf/secure/dte-lab";

const { validateExternalDteFile } = require(resolve(
  repoRoot,
  "lib/dte/config/external-dte-files.ts",
));
const { parseCafRealControlledXml } = require(resolve(
  repoRoot,
  "lib/dte/caf/parse-caf.real.ts",
));
const { SII_DTE_TYPE_CODES } = require(resolve(repoRoot, "lib/dte/dte-types.ts"));

function loadEnvFile(path) {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

function envValue(name) {
  return String(process.env[name] ?? "").trim();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function shortHash(value) {
  return value ? `${value.slice(0, 16)}...${value.slice(-8)}` : "";
}

function hasOpenSsl() {
  const result = spawnSync("openssl", ["version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function openssl(args) {
  return spawnSync("openssl", args, {
    encoding: "utf8",
    input: "",
    timeout: 5000,
    maxBuffer: 1024 * 256,
  });
}

function modeString(path) {
  try {
    return `0${(statSync(path).mode & 0o777).toString(8)}`;
  } catch {
    return "absent";
  }
}

function permissionOk(path, recommended) {
  if (!existsSync(path)) return false;
  const mode = statSync(path).mode & 0o777;
  return (mode & ~recommended) === 0;
}

function allowedExtensions(name) {
  if (name === "DTE_CAF_PATH") return [".xml"];
  if (name === "DTE_CERT_PATH") return [".pem", ".crt", ".cer"];
  return [".pem", ".key"];
}

function expectedDocTypeFromEnv() {
  const raw = envValue("DTE_CERTIFICATION_DOC_TYPE");
  if (!raw) return null;
  if (Object.hasOwn(SII_DTE_TYPE_CODES, raw)) return raw;
  const code = Number(raw);
  if (Number.isInteger(code)) {
    const match = Object.entries(SII_DTE_TYPE_CODES).find(([, value]) => value === code);
    return match?.[0] ?? null;
  }
  return null;
}

function validateFile(name, label, recommendedMode) {
  const path = envValue(name);
  const validation = validateExternalDteFile({
    envName: name,
    pathValue: path,
    repoRoot,
    allowedExtensions: allowedExtensions(name),
  });
  const exists = validation.exists;
  const absolute = Boolean(path) && isAbsolute(path);
  return {
    label,
    envName: name,
    pathConfigured: validation.pathConfigured,
    exists,
    absolute,
    external: validation.outsideRepo,
    status: validation.status,
    ok: validation.ok,
    mode: exists ? modeString(path) : "absent",
    permissionsOk: exists ? permissionOk(path, recommendedMode) : false,
    sha256: exists && validation.ok ? shortHash(sha256File(path)) : null,
    path,
    error: validation.error,
  };
}

function printFileSummary(summary) {
  console.log(`${summary.label}.exists=${summary.exists}`);
  console.log(`${summary.label}.absolute=${summary.absolute}`);
  console.log(`${summary.label}.external=${summary.external}`);
  console.log(`${summary.label}.status=${summary.status}`);
  console.log(`${summary.label}.mode=${summary.mode}`);
  console.log(`${summary.label}.permissionsOk=${summary.permissionsOk}`);
  if (summary.sha256) console.log(`${summary.label}.sha256=${summary.sha256}`);
  if (summary.error && !summary.ok) console.log(`${summary.label}.error=${summary.error}`);
}

function inspectCaf(summary) {
  if (!summary.ok) return { ok: false };
  try {
    const tenantId = envValue("DTE_SMOKE_TENANT_ID") || "tenant-lab-citaya";
    const caf = parseCafRealControlledXml(readFileSync(summary.path, "utf8"), tenantId);
    const expectedType = expectedDocTypeFromEnv();
    const requestedFolio = envValue("DTE_CERTIFICATION_FOLIO") ? Number(envValue("DTE_CERTIFICATION_FOLIO")) : caf.rangeFrom;
    const folioInRange = Number.isInteger(requestedFolio) && requestedFolio >= caf.rangeFrom && requestedFolio <= caf.rangeTo;
    const docTypeMatches = !expectedType || expectedType === caf.documentType;
    console.log(`caf.docType=${caf.documentType}`);
    console.log(`caf.docTypeCode=${SII_DTE_TYPE_CODES[caf.documentType]}`);
    console.log(`caf.docTypeMatchesEnv=${docTypeMatches}`);
    console.log(`caf.folioRange=${caf.rangeFrom}-${caf.rangeTo}`);
    console.log(`caf.requestedFolio=${requestedFolio}`);
    console.log(`caf.folioInRange=${folioInRange}`);
    console.log(`caf.issuerRut=${caf.issuerRut}`);
    console.log(`caf.authorizationDate=${caf.authorizationDate}`);
    console.log(`caf.structuralValid=true`);
    return { ok: folioInRange && docTypeMatches };
  } catch (error) {
    console.log(`caf.structuralValid=false`);
    console.log(`caf.error=${error instanceof Error ? error.message : "CAF validation failed"}`);
    return { ok: false };
  }
}

function inspectCertificate(summary, opensslAvailable) {
  if (!summary.ok) return { ok: false };
  const content = readFileSync(summary.path, "utf8");
  const pemLike = /-----BEGIN CERTIFICATE-----/.test(content);
  console.log(`cert.pemLike=${pemLike}`);
  if (!opensslAvailable) {
    console.log("cert.openssl=unavailable");
    return { ok: pemLike };
  }
  const result = openssl(["x509", "-in", summary.path, "-noout", "-fingerprint", "-sha256", "-subject", "-issuer", "-enddate"]);
  const ok = result.status === 0;
  console.log(`cert.opensslReadable=${ok}`);
  if (ok) {
    for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
      const safeLine = line.length > 180 ? `${line.slice(0, 180)}...` : line;
      if (/^sha256 fingerprint=/i.test(safeLine)) {
        console.log(`cert.fingerprintSha256=${safeLine.split("=").slice(1).join("=")}`);
      } else if (safeLine.startsWith("subject=")) {
        const subject = safeLine.slice("subject=".length);
        console.log("cert.subjectPresent=true");
        console.log(`cert.subjectSha256=${shortHash(createHash("sha256").update(subject).digest("hex"))}`);
      } else if (safeLine.startsWith("issuer=")) {
        const issuer = safeLine.slice("issuer=".length);
        console.log("cert.issuerPresent=true");
        console.log(`cert.issuerSha256=${shortHash(createHash("sha256").update(issuer).digest("hex"))}`);
      } else if (safeLine.startsWith("notAfter=")) {
        console.log(`cert.notAfter=${safeLine.slice("notAfter=".length)}`);
      }
    }
  } else {
    console.log(`cert.opensslError=${(result.stderr || result.stdout || "openssl x509 failed").trim().split(/\r?\n/)[0]}`);
  }
  return { ok: ok && pemLike };
}

function inspectPrivateKey(summary, label, opensslAvailable) {
  if (!summary.ok) return { ok: false };
  const content = readFileSync(summary.path, "utf8");
  const pemLike = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content);
  console.log(`${label}.pemLike=${pemLike}`);
  if (!opensslAvailable) {
    console.log(`${label}.openssl=unavailable`);
    return { ok: pemLike };
  }
  const result = openssl(["pkey", "-in", summary.path, "-noout", "-check"]);
  const ok = result.status === 0;
  console.log(`${label}.opensslReadable=${ok}`);
  if (!ok) {
    console.log(`${label}.opensslError=${(result.stderr || result.stdout || "openssl pkey failed").trim().split(/\r?\n/)[0]}`);
  }
  return { ok: ok && pemLike };
}

loadEnvFile(envPath);
const opensslAvailable = hasOpenSsl();
const caf = validateFile("DTE_CAF_PATH", "caf", 0o640);
const cafKey = validateFile("DTE_CAF_PRIVATE_KEY_PATH", "cafPrivateKey", 0o600);
const cert = validateFile("DTE_CERT_PATH", "cert", 0o640);
const privateKey = validateFile("DTE_PRIVATE_KEY_PATH", "privateKey", 0o600);

console.log("Citaya DTE External Files Check");
console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
console.log(`envFileLoaded=${existsSync(envPath)}`);
console.log(`secureRoot=${secureRoot}`);
console.log(`opensslAvailable=${opensslAvailable}`);
console.log("siiContact=false");
console.log("trackIdSimulated=false");
console.log("");

for (const summary of [caf, cafKey, cert, privateKey]) {
  printFileSummary(summary);
  console.log("");
}

const cafInspection = inspectCaf(caf);
const certInspection = inspectCertificate(cert, opensslAvailable);
const cafKeyInspection = inspectPrivateKey(cafKey, "cafPrivateKey", opensslAvailable);
const privateKeyInspection = inspectPrivateKey(privateKey, "privateKey", opensslAvailable);

const readyForXml = [caf, cafKey, cert, privateKey].every((item) => item.ok) &&
  cafInspection.ok &&
  certInspection.ok &&
  cafKeyInspection.ok &&
  privateKeyInspection.ok;

console.log("");
console.log(`readyForXml=${readyForXml}`);
console.log("noProduction=true");
console.log("submitReady=false");

process.exit(readyForXml ? 0 : 1);
