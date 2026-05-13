import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { getSiiDteTypeCode, SII_DTE_TYPE_CODES } from "../dte-types";
import type { DteDocumentType } from "../dte-types";
import { normalizeRut } from "../rut";
import type { CafRealData, TaxDocumentDraft } from "../types";

function readTag(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function readRequiredTag(xml: string, tagName: string): string {
  const value = readTag(xml, tagName);
  if (!value) throw new Error(`CAF controlado incompleto: falta <${tagName}>`);
  return value;
}

function readRequiredNumber(xml: string, tagName: string): number {
  const value = Number(readRequiredTag(xml, tagName));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`CAF controlado invalido: <${tagName}> debe ser entero positivo`);
  }
  return value;
}

function mapSiiCodeToDocumentType(value: string): DteDocumentType {
  const code = Number(value);
  const entry = Object.entries(SII_DTE_TYPE_CODES).find(
    ([, siiCode]) => siiCode === code,
  );
  if (!entry) throw new Error(`Tipo DTE CAF no soportado: ${value}`);
  return entry[0] as DteDocumentType;
}

function hashXml(xml: string): string {
  return createHash("sha256").update(xml).digest("hex");
}

function extractCafXml(xml: string): string {
  const match = xml.match(/<CAF(?:\s[^>]*)?>[\s\S]*<\/CAF>/i);
  if (!match) throw new Error("CAF controlado debe incluir nodo <CAF>");
  return match[0].trim();
}

// Controlado / NO PRODUCTIVO: parsea estructura CAF sin validar firma criptografica SII.
export function parseCafRealControlledXml(
  cafXml: string,
  tenantId: string,
): CafRealData {
  if (!tenantId.trim()) throw new Error("tenantId requerido para CAF controlado");
  if (!cafXml.includes("<CAF")) throw new Error("CAF controlado debe incluir nodo <CAF>");

  const normalizedCafXml = extractCafXml(cafXml);
  const issuerRut = normalizeRut(readRequiredTag(cafXml, "RE"));
  const documentType = mapSiiCodeToDocumentType(readRequiredTag(cafXml, "TD"));
  const rangeFrom = readRequiredNumber(cafXml, "D");
  const rangeTo = readRequiredNumber(cafXml, "H");
  const authorizationDate = readRequiredTag(cafXml, "FA");
  const issuerLegalName = readRequiredTag(cafXml, "RS");
  const publicKeyModulus = readRequiredTag(cafXml, "M");
  const publicKeyExponent = readRequiredTag(cafXml, "E");
  const keyId = readRequiredTag(cafXml, "IDK");
  const cafSignature = readRequiredTag(cafXml, "FRMA");

  if (rangeFrom > rangeTo) {
    throw new Error("CAF controlado invalido: rango desde/hasta inconsistente");
  }

  return {
    tenantId,
    issuerRut,
    issuerLegalName,
    documentType,
    rangeFrom,
    rangeTo,
    authorizationDate,
    cafXmlHash: hashXml(normalizedCafXml),
    cafXml: normalizedCafXml,
    publicKeyAlgorithm: "RSA",
    publicKeyModulus,
    publicKeyExponent,
    keyId,
    cafSignature,
    mode: "controlled",
    isProductionValid: false,
  };
}

export function loadCafRealControlledFromFile(
  path: string,
  tenantId: string,
): CafRealData {
  if (!path.trim()) throw new Error("DTE_CAF_PATH requerido");
  if (!existsSync(path)) throw new Error("DTE_CAF_PATH no existe");
  return parseCafRealControlledXml(readFileSync(path, "utf8"), tenantId);
}

export function loadCafRealControlledFromEnv(tenantId: string): CafRealData {
  return loadCafRealControlledFromFile(
    String(process.env.DTE_CAF_PATH ?? ""),
    tenantId,
  );
}

export function validateCafForDraftOrThrow(
  caf: CafRealData,
  draft: TaxDocumentDraft,
): void {
  const issuerRut = normalizeRut(draft.issuer.rut);
  if (caf.issuerRut !== issuerRut) {
    throw new Error("CAF RUT emisor no coincide con el draft");
  }

  const expectedTypeCode = getSiiDteTypeCode(draft.documentType);
  const cafTypeCode = getSiiDteTypeCode(caf.documentType);
  if (cafTypeCode !== expectedTypeCode) {
    throw new Error("CAF tipo DTE no coincide con el draft");
  }

  if (draft.folio < caf.rangeFrom || draft.folio > caf.rangeTo) {
    throw new Error("Folio del draft fuera del rango CAF");
  }
}
