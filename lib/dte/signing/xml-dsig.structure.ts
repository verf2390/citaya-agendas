import { createHash } from "node:crypto";

import { escapeXml } from "../xml/escape-xml";
import type { XmlDsigBuildInput, XmlDsigBuildResult } from "../types";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

function sha1Base64(value: string): string {
  return createHash("sha1").update(value).digest("base64");
}

export function buildSyntheticXmlDsigForXsd(
  input: XmlDsigBuildInput,
): XmlDsigBuildResult {
  const digest = sha1Base64(input.signedXmlFragment);
  const signatureValue = sha1Base64(
    `${input.referenceUri}:${input.signedXmlFragment}:LAB-XSD-STRUCTURE`,
  );
  return {
    mode: "xsd-structure",
    isProductionValid: false,
    warnings: [
      "Signature XMLDSig sintetica solo para validar estructura XSD.",
      "No contiene firma criptografica real ni certificado real.",
    ],
    signatureXml: [
      `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">`,
      "  <SignedInfo>",
      `    <CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>`,
      `    <SignatureMethod Algorithm="${RSA_SHA1}"></SignatureMethod>`,
      `    <Reference URI="#${escapeXml(input.referenceUri)}">`,
      "      <Transforms>",
      `        <Transform Algorithm="${C14N}"></Transform>`,
      "      </Transforms>",
      `      <DigestMethod Algorithm="${SHA1}"></DigestMethod>`,
      `      <DigestValue>${digest}</DigestValue>`,
      "    </Reference>",
      "  </SignedInfo>",
      `  <SignatureValue>${signatureValue}</SignatureValue>`,
      "  <KeyInfo>",
      "    <KeyValue>",
      "      <RSAKeyValue>",
      "        <Modulus>AA==</Modulus>",
      "        <Exponent>AQAB</Exponent>",
      "      </RSAKeyValue>",
      "    </KeyValue>",
      "    <X509Data>",
      "      <X509Certificate>AA==</X509Certificate>",
      "    </X509Data>",
      "  </KeyInfo>",
      "</Signature>",
    ].join("\n"),
  };
}
