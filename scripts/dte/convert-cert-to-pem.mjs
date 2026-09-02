#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const secureRoot = "/home/verf/secure/dte-lab";
const certDir = `${secureRoot}/certs`;
const privateDir = `${secureRoot}/private`;
const defaultCertOut = `${certDir}/certificado-digital.pem`;
const defaultKeyOut = `${privateDir}/certificado-private-key.pem`;

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? "";
}

function envValue(name) {
  return String(process.env[name] ?? "").trim();
}

function hasOpenSsl() {
  const result = spawnSync("openssl", ["version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function assertExternalInput(path) {
  if (!path) throw new Error("Falta --input=/ruta/certificado.p12 o DTE_CERT_P12_PATH.");
  if (!isAbsolute(path)) throw new Error("El input P12/PFX debe ser ruta absoluta externa.");
  const ext = extname(path).toLowerCase();
  if (ext !== ".p12" && ext !== ".pfx") throw new Error("El input debe ser .p12 o .pfx.");
  if (!existsSync(path)) throw new Error("El input P12/PFX no existe.");
}

function assertSafeOutput(path, expectedDir) {
  const resolved = resolve(path);
  const expected = resolve(expectedDir);
  if (!resolved.startsWith(`${expected}/`) && resolved !== expected) {
    throw new Error(`Output fuera de carpeta segura: ${expectedDir}`);
  }
  return resolved;
}

function printManualCommands(input, certOut, keyOut) {
  console.log("opensslAvailable=false");
  console.log("No se pudo ejecutar openssl. Comandos equivalentes, ejecutar fuera del repo:");
  console.log(`openssl pkcs12 -in ${input} -clcerts -nokeys -out ${certOut}`);
  console.log(`openssl pkcs12 -in ${input} -nocerts -nodes -out ${keyOut}`);
  console.log(`chmod 600 ${keyOut}`);
  console.log("No guardar password en repo. Preferir DTE_CERT_P12_PASSWORD solo en entorno local temporal.");
}

function runOpenSsl(args, passwordConfigured) {
  const finalArgs = passwordConfigured ? [...args, "-passin", "env:DTE_CERT_P12_PASSWORD"] : args;
  return spawnSync("openssl", finalArgs, {
    encoding: "utf8",
    input: "",
    timeout: 15000,
    maxBuffer: 1024 * 512,
    env: process.env,
  });
}

const input = argValue("input") || envValue("DTE_CERT_P12_PATH");
const certOut = assertSafeOutput(argValue("cert-out") || envValue("DTE_CERT_CONVERT_CERT_OUT") || defaultCertOut, certDir);
const keyOut = assertSafeOutput(argValue("key-out") || envValue("DTE_CERT_CONVERT_KEY_OUT") || defaultKeyOut, privateDir);
const passwordConfigured = Boolean(envValue("DTE_CERT_P12_PASSWORD"));

console.log("Citaya DTE Certificate P12/PFX to PEM Converter");
console.log("globalStatus=LAB / PENDIENTE / NO PRODUCTIVO");
console.log("siiContact=false");
console.log("trackIdSimulated=false");
console.log("noProduction=true");
console.log(`inputFile=${input ? basename(input) : "missing"}`);
console.log(`certOut=${certOut}`);
console.log(`keyOut=${keyOut}`);
console.log(`passwordConfigured=${passwordConfigured}`);

try {
  assertExternalInput(input);
} catch (error) {
  console.error(`blocked_conversion=${error instanceof Error ? error.message : "input invalido"}`);
  if (!hasOpenSsl()) printManualCommands(input || "/ruta/externa/certificado.p12", certOut, keyOut);
  process.exit(2);
}

if (!hasOpenSsl()) {
  printManualCommands(input, certOut, keyOut);
  process.exit(3);
}

mkdirSync(certDir, { recursive: true, mode: 0o750 });
mkdirSync(privateDir, { recursive: true, mode: 0o700 });

const certResult = runOpenSsl(["pkcs12", "-in", input, "-clcerts", "-nokeys", "-out", certOut], passwordConfigured);
if (certResult.status !== 0) {
  console.error("certConversion=failed");
  console.error((certResult.stderr || certResult.stdout || "openssl certificado fallo").trim().split(/\r?\n/)[0]);
  console.error("No se imprimio certificado completo ni password.");
  process.exit(1);
}

const keyResult = runOpenSsl(["pkcs12", "-in", input, "-nocerts", "-nodes", "-out", keyOut], passwordConfigured);
if (keyResult.status !== 0) {
  console.error("keyConversion=failed");
  console.error((keyResult.stderr || keyResult.stdout || "openssl private key fallo").trim().split(/\r?\n/)[0]);
  console.error("No se imprimio private key ni password.");
  process.exit(1);
}

chmodSync(keyOut, 0o600);
try {
  chmodSync(certOut, 0o640);
} catch {}

console.log("certConversion=ok");
console.log("keyConversion=ok");
console.log("privateKeyMode=0600");
console.log("No se imprimio private key, certificado completo ni password.");
console.log("Siguiente paso: npm run dte:external:check");
