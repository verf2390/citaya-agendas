import { createHash, createPrivateKey, createPublicKey, createSign, createVerify, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { normalizeRut } from "../rut";

export type CafTrustAnchor = { idk: string; mode: "fixture" | "real"; publicKeyPath: string; provenance: string; sha256: string };
export type CafTrustStore = ReadonlyMap<string, CafTrustAnchor>;
export type ImportedCaf = {
  sourcePath: string; originalBytes: Buffer; originalXml: string; cafXml: string; cafBytes: Buffer; daXml: string; daBytes: Buffer;
  issuerRut: string; issuerName: string; typeCode: 33 | 56 | 61; rangeFrom: number; rangeTo: number; authorizationDate: string;
  idk: string; privateKeyPem: string; publicKeyPem: string; sha256: string; logicalIdentity: string;
  fixtureKey: true; weakLegacyFixture: boolean; realUseBlocked: true;
};
export type LoadCafOptions = { repoRoot: string; expectedIssuerRut: string; expectedType: 33 | 56 | 61; minimumAvailable: number; trustStore: CafTrustStore; fixtureMode: boolean };

function reject(field: string): never { throw new Error(`CAF_REJECTED field=${field}`); }
function isInside(parent: string, candidate: string): boolean { const rel = relative(resolve(parent), resolve(candidate)); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".."); }
function one(xml: string, tag: string): string {
  const matches = [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g"))];
  if (matches.length !== 1) reject(tag);
  return matches[0][0];
}
function value(xml: string, tag: string): string {
  const block = one(xml, tag); const match = block.match(new RegExp(`^<${tag}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${tag}>$`));
  if (!match) reject(tag); return match[1].trim();
}
function positive(raw: string, field: string): number { if (!/^[1-9]\d*$/.test(raw)) reject(field); const n = Number(raw); if (!Number.isSafeInteger(n)) reject(field); return n; }
function assertDate(raw: string): void { if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) reject("FA"); }
function assertRut(raw: string): string {
  const rut = normalizeRut(raw); const match = rut.match(/^(\d+)-([0-9K])$/); if (!match) reject("RE");
  let sum = 0; let multiplier = 2; for (let index = match[1].length - 1; index >= 0; index -= 1) { sum += Number(match[1][index]) * multiplier; multiplier = multiplier === 7 ? 2 : multiplier + 1; }
  const digit = 11 - (sum % 11); const expected = digit === 11 ? "0" : digit === 10 ? "K" : String(digit); if (expected !== match[2]) reject("RE"); return rut;
}
function pem(raw: string, field: string): string { const decoded = raw.replace(/&#10;/g, "\n").replace(/&amp;/g, "&").trim(); if (!decoded.includes("-----BEGIN") || !decoded.includes("-----END")) reject(field); return `${decoded}\n`; }

export function loadCafAuthorization(path: string, options: LoadCafOptions): ImportedCaf {
  const absolute = resolve(path); if (isInside(options.repoRoot, absolute)) reject("path");
  const stat = lstatSync(absolute); if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute) reject("path");
  if ((stat.mode & 0o077) !== 0) reject("permissions"); if (stat.size <= 0 || stat.size > 1024 * 1024) reject("size");
  const bytes = readFileSync(absolute); if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) || bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) reject("BOM");
  const xml = bytes.toString("latin1"); if (Buffer.from(xml, "latin1").compare(bytes) || !/^<\?xml version="1\.0" encoding="ISO-8859-1"\?>/.test(xml)) reject("encoding");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) reject("DOCTYPE"); if (!/^<\?xml[^?]*\?>\s*<AUTORIZACION>[\s\S]*<\/AUTORIZACION>\s*$/.test(xml)) reject("AUTORIZACION");
  let parseError = false; const document = new DOMParser({ onError: (level) => { if (level !== "warning") parseError = true; } }).parseFromString(xml, "application/xml");
  const root = document.documentElement; if (parseError || !root || root.tagName !== "AUTORIZACION") reject("AUTORIZACION");
  const childNames = Array.from(root.childNodes).filter((node) => node.nodeType === 1).map((node) => node.nodeName).join(","); if (childNames !== "CAF,RSASK,RSAPUBK") reject("AUTORIZACION");
  for (const field of ["AUTORIZACION", "CAF", "DA", "FRMA", "RSASK", "RSAPUBK"]) one(xml, field);
  const cafXml = one(xml, "CAF"); if (!/^<CAF version="1\.0">/.test(cafXml)) reject("CAF"); const daXml = one(cafXml, "DA"); const frmaXml = one(cafXml, "FRMA"); if (!/^<FRMA algoritmo="SHA1withRSA">/.test(frmaXml)) reject("FRMA");
  const issuerRut = assertRut(value(daXml, "RE")); if (issuerRut !== normalizeRut(options.expectedIssuerRut)) reject("RE");
  const typeCode = positive(value(daXml, "TD"), "TD"); if (![33, 56, 61].includes(typeCode) || typeCode !== options.expectedType) reject("TD");
  const rangeFrom = positive(value(daXml, "D"), "RNG.D"); const rangeTo = positive(value(daXml, "H"), "RNG.H"); if (rangeFrom > rangeTo || rangeTo - rangeFrom + 1 < options.minimumAvailable) reject("RNG");
  const authorizationDate = value(daXml, "FA"); assertDate(authorizationDate); const idk = value(daXml, "IDK"); if (!idk) reject("IDK");
  const anchor = options.trustStore.get(idk); if (!anchor) reject("IDK"); if (options.fixtureMode ? anchor.mode !== "fixture" : anchor.mode !== "real") reject("trustAnchor.mode"); if (!options.fixtureMode && !anchor.provenance.startsWith("official:")) reject("trustAnchor.provenance");
  const anchorBytes = readFileSync(anchor.publicKeyPath); if (createHash("sha256").update(anchorBytes).digest("hex") !== anchor.sha256) reject("trustAnchor.sha256");
  const frmaVerifier = createVerify("RSA-SHA1"); frmaVerifier.update(Buffer.from(daXml, "latin1")); if (!frmaVerifier.verify(anchorBytes, value(frmaXml, "FRMA"), "base64")) reject("FRMA");
  const privateKeyPem = pem(value(xml, "RSASK"), "RSASK"); const publicKeyPem = pem(value(xml, "RSAPUBK"), "RSAPUBK");
  let derived: ReturnType<typeof createPublicKey>; let supplied: ReturnType<typeof createPublicKey>; try { derived = createPublicKey(createPrivateKey(privateKeyPem)); supplied = createPublicKey(publicKeyPem); } catch { reject("RSASK/RSAPUBK"); }
  const derivedDer = derived.export({ type: "spki", format: "der" }); const suppliedDer = supplied.export({ type: "spki", format: "der" }); if (derivedDer.compare(suppliedDer)) reject("RSASK/RSAPUBK");
  const jwk = supplied.export({ format: "jwk" }) as { kty?: string; n?: string; e?: string }; if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) reject("RSAPUBK");
  if (!Buffer.from(jwk.n, "base64url").equals(Buffer.from(value(daXml, "M"), "base64")) || !Buffer.from(jwk.e, "base64url").equals(Buffer.from(value(daXml, "E"), "base64"))) reject("RSAPK");
  const challenge = randomBytes(32); const signer = createSign("RSA-SHA1"); signer.update(challenge); const signature = signer.sign(privateKeyPem); for (const key of [derived, supplied]) { const verifier = createVerify("RSA-SHA1"); verifier.update(challenge); if (!verifier.verify(key, signature)) reject("RSASK/RSAPUBK"); }
  const sha256 = createHash("sha256").update(bytes).digest("hex"); const logicalIdentity = createHash("sha256").update(`${issuerRut}|${typeCode}|${rangeFrom}|${rangeTo}|${idk}`).digest("hex");
  return { sourcePath: absolute, originalBytes: bytes, originalXml: xml, cafXml, cafBytes: Buffer.from(cafXml, "latin1"), daXml, daBytes: Buffer.from(daXml, "latin1"), issuerRut, issuerName: value(daXml, "RS"), typeCode: typeCode as 33 | 56 | 61, rangeFrom, rangeTo, authorizationDate, idk, privateKeyPem, publicKeyPem, sha256, logicalIdentity, fixtureKey: true, weakLegacyFixture: Buffer.from(jwk.n, "base64url").length * 8 < 1024, realUseBlocked: true };
}

export function assertNoOverlappingOrDuplicateCafs(cafs: readonly ImportedCaf[]): void {
  const hashes = new Set<string>(); const identities = new Set<string>();
  for (const caf of cafs) { if (hashes.has(caf.sha256) || identities.has(caf.logicalIdentity)) reject("duplicate"); hashes.add(caf.sha256); identities.add(caf.logicalIdentity); }
  for (let left = 0; left < cafs.length; left += 1) for (let right = left + 1; right < cafs.length; right += 1) { const a = cafs[left]; const b = cafs[right]; if (a.issuerRut === b.issuerRut && a.typeCode === b.typeCode && a.rangeFrom <= b.rangeTo && b.rangeFrom <= a.rangeTo) reject("RNG.overlap"); }
}
