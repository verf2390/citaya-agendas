import type {
  SignedXmlResult,
  SigningCertificateInput,
  XmlSignatureOptions,
} from "../types";

export type SignXmlInput = {
  xml: string;
  tenantId: string;
  certificateSecretRef?: string;
  environment: "certification" | "production";
};

export type SignXmlResult = {
  ok: true;
  signedXml: string;
  status: "signed";
  signatureMode: "mock";
};

const DEFAULT_SIGNATURE_OPTIONS: XmlSignatureOptions = {
  signatureTarget: "Documento",
  canonicalizationMethod: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  signatureMethod: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
  digestMethod: "http://www.w3.org/2000/09/xmldsig#sha1",
  includeKeyInfo: true,
  mode: "mock",
};

function buildSignatureId(): string {
  return `CitayaMockSignature-${Date.now()}`;
}

function insertMockSignature(xml: string, signatureXml: string): string {
  if (xml.includes("</Documento>")) {
    return xml.replace("</Documento>", `        ${signatureXml}\n      </Documento>`);
  }

  return `${xml}\n${signatureXml}`;
}

// LAB / MOCK: estructura visual cercana a XMLDSig, no firma criptográfica real.
export function signXmlMockForLab(
  xml: string,
  options: Partial<XmlSignatureOptions> = {},
): SignedXmlResult {
  const mergedOptions: XmlSignatureOptions = {
    ...DEFAULT_SIGNATURE_OPTIONS,
    ...options,
    mode: "mock",
  };
  const signatureId = buildSignatureId();
  const signedAt = new Date().toISOString();
  const signatureXml = [
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#" Id="${signatureId}">`,
    "          <SignedInfo>",
    `            <CanonicalizationMethod Algorithm="${mergedOptions.canonicalizationMethod}" />`,
    `            <SignatureMethod Algorithm="${mergedOptions.signatureMethod}" />`,
    `            <Reference URI="#${mergedOptions.signatureTarget}">`,
    `              <DigestMethod Algorithm="${mergedOptions.digestMethod}" />`,
    "              <DigestValue>MOCK-DIGEST-LAB-NO-PRODUCTIVO</DigestValue>",
    "            </Reference>",
    "          </SignedInfo>",
    "          <SignatureValue>MOCK-SIGNATURE-LAB-NO-PRODUCTIVO</SignatureValue>",
    mergedOptions.includeKeyInfo
      ? "          <KeyInfo><KeyName>MOCK-LAB-CERTIFICATE</KeyName></KeyInfo>"
      : null,
    "        </Signature>",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    signedXml: insertMockSignature(xml, signatureXml),
    signatureId,
    signedAt,
    mode: "mock",
    warnings: [
      "Firma MOCK de laboratorio. No es firma XML real.",
      "No usa certificado, clave privada ni password.",
      "Pendiente validar contra xmldsignature_v10.xsd.",
    ],
    xsdReference: "xmldsignature_v10.xsd",
    isProductionValid: false,
  };
}

export async function signXmlForLab(
  xml: string,
  certificateInput: SigningCertificateInput,
  options: XmlSignatureOptions,
): Promise<SignedXmlResult> {
  if (options.mode !== "lab") {
    throw new Error("signXmlForLab only accepts lab mode for controlled testing");
  }

  if (!certificateInput.tenantId) {
    throw new Error("tenantId is required to prepare lab XML signing");
  }

  if (
    !certificateInput.certificateBuffer &&
    !certificateInput.certificatePem &&
    !certificateInput.privateKeyPem
  ) {
    throw new Error(
      [
        "Lab XML signing requires a controlled test certificate input.",
        "Pending implementation: load certificate, extract private key, canonicalize XML, calculate digest, sign target node, insert Signature, validate against xmldsignature_v10.xsd, DTE_v10.xsd and EnvioDTE_v10.xsd, then test in SII certification.",
      ].join(" "),
    );
  }

  if (!xml.trim()) {
    throw new Error("xml is required to prepare lab XML signing");
  }

  throw new Error(
    "Real lab XML signing is not implemented yet. Do not use production certificates or private keys.",
  );
}

export async function signXmlPlaceholder(
  input: SignXmlInput,
): Promise<SignXmlResult> {
  const signed = signXmlMockForLab(input.xml, {
    signatureTarget: `tenant-${input.tenantId}`,
  });

  return {
    ok: true,
    status: "signed",
    signatureMode: "mock",
    signedXml: `${signed.signedXml}\n<!-- MOCK SIGNATURE: tenant=${input.tenantId}; env=${input.environment}; no usar en SII -->`,
  };
}
