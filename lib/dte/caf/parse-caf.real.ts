import { createHash } from "node:crypto";

import { SII_DTE_TYPE_CODES } from "../dte-types";
import type { DteDocumentType } from "../dte-types";
import { normalizeRut } from "../rut";
import type { CafRealData } from "../types";

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

// Controlado / NO PRODUCTIVO: parsea estructura CAF sin validar firma criptografica SII.
export function parseCafRealControlledXml(
  cafXml: string,
  tenantId: string,
): CafRealData {
  if (!tenantId.trim()) throw new Error("tenantId requerido para CAF controlado");
  if (!cafXml.includes("<CAF")) throw new Error("CAF controlado debe incluir nodo <CAF>");

  const issuerRut = normalizeRut(readRequiredTag(cafXml, "RE"));
  const documentType = mapSiiCodeToDocumentType(readRequiredTag(cafXml, "TD"));
  const rangeFrom = readRequiredNumber(cafXml, "D");
  const rangeTo = readRequiredNumber(cafXml, "H");
  const authorizationDate = readRequiredTag(cafXml, "FA");

  if (rangeFrom > rangeTo) {
    throw new Error("CAF controlado invalido: rango desde/hasta inconsistente");
  }

  return {
    tenantId,
    issuerRut,
    documentType,
    rangeFrom,
    rangeTo,
    authorizationDate,
    cafXmlHash: hashXml(cafXml),
    publicKeyAlgorithm: readTag(cafXml, "ALGO"),
    publicKeyModulus: readTag(cafXml, "M"),
    publicKeyExponent: readTag(cafXml, "E"),
    cafSignature: readTag(cafXml, "FRMA"),
    mode: "controlled",
    isProductionValid: false,
  };
}

