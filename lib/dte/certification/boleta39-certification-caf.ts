import {
  createHash,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";

import { parseCafRealControlledXml } from "../caf/parse-caf.real";
import { normalizeRut } from "../rut";

export const CERTIFICATION_FRMA_EXCEPTION_STATUS =
  "not_independently_verified_missing_official_idk100_anchor" as const;

export type Boleta39CertificationAuthorization = {
  schemaVersion: 1;
  environment: "certification";
  tenantId: string;
  tenantSlug: string;
  issuerRut: string;
  documentType: 39;
  rangeFrom: 1;
  rangeTo: 5;
  idk: "100";
  cafPath: string;
  cafSha256: string;
  authorizationDate: string;
  frmaVerificationStatus: typeof CERTIFICATION_FRMA_EXCEPTION_STATUS;
  reason: string;
  actorId: string;
  authorizedAt: string;
};

export type AuthorizedBoleta39Caf = {
  authorization: Boleta39CertificationAuthorization;
  cafXml: string;
  cafPrivateKeyPem: string;
  cafPublicKeyPem: string;
  sha256: string;
};

function reject(field: string): never {
  throw new Error(`DTE_CERTIFICATION_CAF_REJECTED field=${field}`);
}

function inside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function secureFile(path: string, repoRoot: string, expectedOwnerUid: number): Buffer {
  const absolute = resolve(path);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute)
    reject("path");
  if ((stat.mode & 0o777) !== 0o600 || stat.uid !== expectedOwnerUid)
    reject("custody");
  if (inside(repoRoot, absolute)) reject("repoPath");
  if (stat.size <= 0 || stat.size > 1024 * 1024) reject("size");
  return readFileSync(absolute);
}

function one(xml: string, tag: string): string {
  const matches = [
    ...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g")),
  ];
  if (matches.length !== 1) reject(tag);
  return matches[0][0];
}

function value(xml: string, tag: string): string {
  const block = one(xml, tag);
  const match = block.match(
    new RegExp(`^<${tag}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${tag}>$`),
  );
  if (!match) reject(tag);
  return match[1].trim();
}

function pem(raw: string, field: string): string {
  const decoded = raw.replace(/&#10;/g, "\n").replace(/&amp;/g, "&").trim();
  if (!decoded.includes("-----BEGIN") || !decoded.includes("-----END"))
    reject(field);
  return `${decoded}\n`;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function loadAuthorizedBoleta39CertificationCaf(input: {
  manifestPath: string;
  cafRoot: string;
  repoRoot?: string;
  expectedOwnerUid?: number;
}): AuthorizedBoleta39Caf {
  const repoRoot = resolve(input.repoRoot ?? process.cwd());
  const owner = input.expectedOwnerUid ?? process.getuid?.();
  if (owner === undefined) reject("owner.unsupported");
  const manifestBytes = secureFile(input.manifestPath, repoRoot, owner);
  let authorization: Boleta39CertificationAuthorization;
  try {
    authorization = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    reject("manifest.json");
  }
  if (
    authorization.schemaVersion !== 1 ||
    authorization.environment !== "certification" ||
    !/^[a-z0-9][a-z0-9-]{1,62}$/.test(authorization.tenantSlug) ||
    !uuid(authorization.tenantId) ||
    !uuid(authorization.actorId) ||
    !normalizeRut(authorization.issuerRut) ||
    authorization.documentType !== 39 ||
    authorization.rangeFrom !== 1 ||
    authorization.rangeTo !== 5 ||
    authorization.idk !== "100" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(authorization.authorizationDate) ||
    authorization.frmaVerificationStatus !== CERTIFICATION_FRMA_EXCEPTION_STATUS ||
    !/^[a-f0-9]{64}$/.test(authorization.cafSha256) ||
    authorization.reason.trim().length < 20 ||
    Number.isNaN(Date.parse(authorization.authorizedAt))
  )
    reject("manifest.scope");
  const cafRoot = resolve(input.cafRoot);
  if (!inside("/home/verf/secure", cafRoot) || inside(repoRoot, cafRoot))
    reject("manifest.cafRoot");
  const cafPath = resolve(authorization.cafPath);
  if (!inside(cafRoot, cafPath) || inside(resolve(cafRoot, "backups"), cafPath))
    reject("manifest.cafPath");
  const bytes = secureFile(cafPath, repoRoot, owner);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== authorization.cafSha256) reject("sha256");
  const xml = bytes.toString("latin1");
  if (!Buffer.from(xml, "latin1").equals(bytes)) reject("encoding");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) reject("DOCTYPE");
  if (!/^<\?xml[^?]*\?>\s*<AUTORIZACION>[\s\S]*<\/AUTORIZACION>\s*$/.test(xml))
    reject("AUTORIZACION");
  const controlled = parseCafRealControlledXml(xml, authorization.tenantId);
  const cafXml = one(xml, "CAF");
  const daXml = one(cafXml, "DA");
  if (
    normalizeRut(controlled.issuerRut) !== normalizeRut(authorization.issuerRut) ||
    controlled.documentType !== "boleta_afecta" ||
    controlled.rangeFrom !== authorization.rangeFrom ||
    controlled.rangeTo !== authorization.rangeTo ||
    controlled.authorizationDate !== authorization.authorizationDate ||
    value(daXml, "IDK") !== authorization.idk ||
    !/^<FRMA algoritmo="SHA1withRSA">/.test(one(cafXml, "FRMA"))
  )
    reject("metadata");
  const cafPrivateKeyPem = pem(value(xml, "RSASK"), "RSASK");
  const cafPublicKeyPem = pem(value(xml, "RSAPUBK"), "RSAPUBK");
  try {
    const derived = createPublicKey(createPrivateKey(cafPrivateKeyPem)).export({
      type: "spki",
      format: "der",
    });
    const suppliedKey = createPublicKey(cafPublicKeyPem);
    const supplied = suppliedKey.export({ type: "spki", format: "der" });
    const da = createPublicKey({
      key: {
        kty: "RSA",
        n: Buffer.from(value(daXml, "M"), "base64").toString("base64url"),
        e: Buffer.from(value(daXml, "E"), "base64").toString("base64url"),
      },
      format: "jwk",
    }).export({ type: "spki", format: "der" });
    if (!derived.equals(supplied) || !supplied.equals(da)) reject("keyPair");
  } catch (error) {
    if (error instanceof Error && error.message.includes("field=keyPair")) throw error;
    reject("keyPair");
  }
  return { authorization, cafXml, cafPrivateKeyPem, cafPublicKeyPem, sha256 };
}
