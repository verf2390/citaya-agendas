import { createHash } from "node:crypto";

import { SII_DTE_TYPE_CODES } from "../dte-types";
import type { DteDocumentType } from "../dte-types";
import { normalizeRut } from "../rut";
import type { CafLabData } from "../types";

export type ParsedCafLabData = {
  issuerRut: string | null;
  documentType: string | null;
  folioFrom: number | null;
  folioTo: number | null;
  rawXml: string;
};

function readTag(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

export function parseCafLabXml(cafXml: string): ParsedCafLabData {
  return {
    issuerRut: readTag(cafXml, "RE"),
    documentType: readTag(cafXml, "TD"),
    folioFrom: Number(readTag(cafXml, "D")) || null,
    folioTo: Number(readTag(cafXml, "H")) || null,
    rawXml: cafXml,
  };
}

function mapSiiCodeToDocumentType(value: string | null): DteDocumentType {
  const code = Number(value);
  const entry = Object.entries(SII_DTE_TYPE_CODES).find(
    ([, siiCode]) => siiCode === code,
  );

  if (!entry) {
    throw new Error(`Unsupported CAF lab document type code: ${value ?? ""}`);
  }

  return entry[0] as DteDocumentType;
}

function readRequiredTag(xml: string, tagName: string): string {
  const value = readTag(xml, tagName);
  if (!value) {
    throw new Error(`CAF lab XML is missing <${tagName}>`);
  }

  return value;
}

function readRequiredNumber(xml: string, tagName: string): number {
  const value = Number(readRequiredTag(xml, tagName));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`CAF lab XML has invalid <${tagName}>`);
  }

  return value;
}

function hashXml(xml: string): string {
  return createHash("sha256").update(xml).digest("hex");
}

// LAB / NO PRODUCTIVO: parser mínimo para CAF dummy. No valida firma ni CAF real.
export function parseCafLabXmlToData(
  cafXml: string,
  tenantId: string,
): CafLabData {
  if (!cafXml.includes("<CAF") && !cafXml.includes("<AUTORIZACION")) {
    throw new Error("CAF lab XML must include CAF or AUTORIZACION root data");
  }

  const issuerRut = normalizeRut(readRequiredTag(cafXml, "RE"));
  const documentType = mapSiiCodeToDocumentType(readRequiredTag(cafXml, "TD"));
  const rangeFrom = readRequiredNumber(cafXml, "D");
  const rangeTo = readRequiredNumber(cafXml, "H");

  if (rangeFrom > rangeTo) {
    throw new Error("CAF lab folio range is invalid");
  }

  const authorizationDate = readTag(cafXml, "FA");
  const issuedAt = authorizationDate ?? new Date().toISOString().slice(0, 10);

  return {
    tenantId,
    issuerRut,
    documentType,
    rangeFrom,
    rangeTo,
    issuedAt,
    authorizationDate,
    rawXmlHash: hashXml(cafXml),
    mode: "lab",
    isProductionValid: false,
  };
}
