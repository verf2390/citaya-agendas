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

