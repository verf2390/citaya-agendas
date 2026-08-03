import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
} from "node:crypto";

import { DOMParser } from "@xmldom/xmldom";
import { C14nCanonicalization } from "xml-crypto";

import { validateRut } from "../rut";
import {
  buildSiiSeedKeyInfoContent,
  verifySignedSeedXml,
} from "../sii/sii-auth";

export const BOLETA_CERTIFICATION_API_BASE =
  "https://apicert.sii.cl/recursos/v1";

export const BOLETA_CERTIFICATION_SEED_URL =
  `${BOLETA_CERTIFICATION_API_BASE}/boleta.electronica.semilla`;

export const BOLETA_CERTIFICATION_TOKEN_URL =
  `${BOLETA_CERTIFICATION_API_BASE}/boleta.electronica.token`;

export const BOLETA_CERTIFICATION_SUBMIT_URL =
  "https://pangal.sii.cl/recursos/v1/boleta.electronica.envio";

export const BOLETA_CERTIFICATION_USER_AGENT =
  "Mozilla/4.0 ( compatible; Citaya 1.0; Linux )";

const XMLDSIG_NAMESPACE =
  "http://www.w3.org/2000/09/xmldsig#";

const XMLDSIG_C14N =
  "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

const XMLDSIG_RSA_SHA1 =
  "http://www.w3.org/2000/09/xmldsig#rsa-sha1";

const XMLDSIG_ENVELOPED =
  "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

const XMLDSIG_SHA1 =
  "http://www.w3.org/2000/09/xmldsig#sha1";

const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8"?>';

export type BoletaRestSignedSeed = {
  unsignedXml: string;
  signedXml: string;
  digestValue: string;
  signedXmlSha256: string;
  verified: true;
};

export type BoletaRestSeedResponse = {
  estado: string;
  glosa: string | null;
  seed: string;
};

export type BoletaRestTokenResponse = {
  estado: string;
  glosa: string | null;
  token: string;
};

export type BoletaRestSubmitResponse = {
  rutEmisor: string;
  rutEnvia: string;
  trackId: string;
  receptionDate: string;
  status: "REC";
  fileName: string;
};

function sha1Base64(value: string): string {
  return createHash("sha1")
    .update(value, "utf8")
    .digest("base64");
}

function sha256(value: string): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function assertSeed(seed: string): void {
  if (!/^[0-9]{1,40}$/.test(seed)) {
    throw new Error("BOLETA_REST_SEED_INVALID");
  }
}

function assertCertificateKeyPair(
  certificatePem: string,
  privateKeyPem: string,
): void {
  try {
    const certificateKey = createPublicKey(
      certificatePem,
    ).export({
      type: "spki",
      format: "der",
    });

    const privateKey = createPublicKey(
      createPrivateKey(privateKeyPem),
    ).export({
      type: "spki",
      format: "der",
    });

    if (
      !Buffer.from(certificateKey).equals(
        Buffer.from(privateKey),
      )
    ) {
      throw new Error("key_pair_mismatch");
    }
  } catch {
    throw new Error(
      "BOLETA_REST_CERTIFICATE_KEY_PAIR_INVALID",
    );
  }
}

function parseXml(xml: string) {
  const document = new DOMParser().parseFromString(
    xml,
    "text/xml",
  );

  if (
    document.getElementsByTagName("parsererror").length > 0
  ) {
    throw new Error("BOLETA_REST_XML_RESPONSE_INVALID");
  }

  return document;
}

function textByLocalName(
  xml: string,
  expectedName: string,
): string | null {
  const document = parseXml(xml);

  const elements = [
    ...(document.documentElement
      ? [document.documentElement]
      : []),
    ...Array.from(document.getElementsByTagName("*")),
  ];

  const match = elements.find((element) => {
    const localName = String(
      element.localName || element.nodeName,
    ).replace(/^.*:/, "");

    return localName === expectedName;
  });

  return match?.textContent?.trim() || null;
}

function statusIsOk(value: string | null): boolean {
  return value === "0" || value === "00";
}

function splitRut(value: string): {
  rut: string;
  dv: string;
} {
  const normalized = value
    .replace(/\./g, "")
    .trim()
    .toUpperCase();

  const match = normalized.match(
    /^([0-9]{7,8})-([0-9K])$/,
  );

  if (!match || !validateRut(normalized)) {
    throw new Error("BOLETA_REST_RUT_INVALID");
  }

  return {
    rut: match[1],
    dv: match[2],
  };
}

export function buildBoletaRestUnsignedTokenXml(
  seed: string,
): string {
  assertSeed(seed);

  const root =
    `<getToken><item><Semilla>${seed}` +
    "</Semilla></item></getToken>";

  return `${XML_DECLARATION}\n${root}`;
}

export function signBoletaRestSeed(
  seed: string,
  privateKeyPem: string,
  certificatePem: string,
): BoletaRestSignedSeed {
  assertSeed(seed);

  if (
    !privateKeyPem.trim() ||
    !certificatePem.trim()
  ) {
    throw new Error(
      "BOLETA_REST_SIGNING_MATERIAL_MISSING",
    );
  }

  assertCertificateKeyPair(
    certificatePem,
    privateKeyPem,
  );

  const unsignedXml =
    buildBoletaRestUnsignedTokenXml(seed);

  const unsignedRoot =
    `<getToken><item><Semilla>${seed}` +
    "</Semilla></item></getToken>";

  const digestValue = sha1Base64(unsignedRoot);

  const signedInfoChildren = [
    `<CanonicalizationMethod Algorithm="${XMLDSIG_C14N}"/>`,
    `<SignatureMethod Algorithm="${XMLDSIG_RSA_SHA1}"/>`,
    '<Reference URI="">',
    "<Transforms>",
    `<Transform Algorithm="${XMLDSIG_ENVELOPED}"/>`,
    "</Transforms>",
    `<DigestMethod Algorithm="${XMLDSIG_SHA1}"/>`,
    `<DigestValue>${digestValue}</DigestValue>`,
    "</Reference>",
  ].join("");

  const standaloneSignedInfo =
    `<SignedInfo xmlns="${XMLDSIG_NAMESPACE}">` +
    signedInfoChildren +
    "</SignedInfo>";

  const signedInfoDocument = parseXml(
    standaloneSignedInfo,
  );

  const canonicalizer =
    new C14nCanonicalization();

  const signedInfoRoot =
    signedInfoDocument.documentElement;

  if (!signedInfoRoot) {
    throw new Error(
      "BOLETA_REST_SIGNED_INFO_ROOT_MISSING",
    );
  }

  const canonicalSignedInfo = String(
    canonicalizer.process(
      signedInfoRoot as unknown as Parameters<
        C14nCanonicalization["process"]
      >[0],
      {},
    ),
  );

  const signer = createSign("RSA-SHA1");

  signer.update(canonicalSignedInfo, "utf8");
  signer.end();

  const signatureValue = signer.sign(
    privateKeyPem,
    "base64",
  );

  const keyInfo =
    buildSiiSeedKeyInfoContent(certificatePem);

  const signatureXml = [
    `<Signature xmlns="${XMLDSIG_NAMESPACE}">`,
    "<SignedInfo>",
    signedInfoChildren,
    "</SignedInfo>",
    `<SignatureValue>${signatureValue}</SignatureValue>`,
    `<KeyInfo>${keyInfo}</KeyInfo>`,
    "</Signature>",
  ].join("");

  const signedRoot = unsignedRoot.replace(
    "</item></getToken>",
    `</item>${signatureXml}</getToken>`,
  );

  const signedXml =
    `${XML_DECLARATION}\n${signedRoot}`;

  if (signedXml.endsWith("\n")) {
    throw new Error(
      "BOLETA_REST_SIGNED_XML_TRAILING_NEWLINE",
    );
  }

  if (
    !signedXml.includes('<Reference URI="">')
  ) {
    throw new Error(
      "BOLETA_REST_REFERENCE_URI_NOT_EMPTY",
    );
  }

  if (
    !verifySignedSeedXml(
      signedXml,
      certificatePem,
    )
  ) {
    throw new Error(
      "BOLETA_REST_SIGNATURE_VERIFICATION_FAILED",
    );
  }

  const recoveredUnsigned = signedXml.replace(
    /<Signature\b[\s\S]*?<\/Signature>/,
    "",
  );

  if (recoveredUnsigned !== unsignedXml) {
    throw new Error(
      "BOLETA_REST_UNSIGNED_XML_NOT_RECOVERABLE",
    );
  }

  return {
    unsignedXml,
    signedXml,
    digestValue,
    signedXmlSha256: sha256(signedXml),
    verified: true,
  };
}

export function parseBoletaRestSeedResponse(
  xml: string,
): BoletaRestSeedResponse {
  const estado = textByLocalName(
    xml,
    "ESTADO",
  );

  const glosa = textByLocalName(
    xml,
    "GLOSA",
  );

  const seed =
    textByLocalName(xml, "SEMILLA") ??
    textByLocalName(xml, "Semilla");

  if (
    !statusIsOk(estado) ||
    !seed ||
    !/^[0-9]{1,40}$/.test(seed)
  ) {
    throw new Error(
      "BOLETA_REST_SEED_RESPONSE_INVALID",
    );
  }

  return {
    estado: estado!,
    glosa,
    seed,
  };
}

export function parseBoletaRestTokenResponse(
  xml: string,
): BoletaRestTokenResponse {
  const estado = textByLocalName(
    xml,
    "ESTADO",
  );

  const glosa = textByLocalName(
    xml,
    "GLOSA",
  );

  const token =
    textByLocalName(xml, "TOKEN") ??
    textByLocalName(xml, "Token");

  if (
    !statusIsOk(estado) ||
    !token ||
    token.length > 500
  ) {
    throw new Error(
      "BOLETA_REST_TOKEN_RESPONSE_INVALID",
    );
  }

  return {
    estado: estado!,
    glosa,
    token,
  };
}

export function parseBoletaRestSubmitResponse(
  raw: string,
): BoletaRestSubmitResponse {
  let value: Record<string, unknown>;

  try {
    value = JSON.parse(raw) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_NOT_JSON",
    );
  }

  const trackId = String(
    value.trackid ?? "",
  );

  if (
    value.estado !== "REC" ||
    !/^[0-9]{1,15}$/.test(trackId)
  ) {
    throw new Error(
      "BOLETA_REST_SUBMIT_RESPONSE_INVALID",
    );
  }

  return {
    rutEmisor: String(value.rut_emisor ?? ""),
    rutEnvia: String(value.rut_envia ?? ""),
    trackId,
    receptionDate: String(
      value.fecha_recepcion ?? "",
    ),
    status: "REC",
    fileName: String(value.file ?? ""),
  };
}

export function parseBoletaRetryAfter(
  value: string | null,
): number | null {
  if (!value || !/^[0-9]{1,5}$/.test(value)) {
    return null;
  }

  const seconds = Number(value);

  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    seconds > 86_400
  ) {
    return null;
  }

  return seconds;
}

export function buildBoletaRestStatusUrl(
  companyRut: string,
  trackId: string,
): string {
  const company = splitRut(companyRut);

  if (!/^[0-9]{1,15}$/.test(trackId)) {
    throw new Error(
      "BOLETA_REST_TRACK_ID_INVALID",
    );
  }

  return (
    `${BOLETA_CERTIFICATION_API_BASE}` +
    "/boleta.electronica.envio/" +
    `${company.rut}-${company.dv}-${trackId}`
  );
}
