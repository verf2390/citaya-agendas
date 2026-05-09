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

export async function signXmlPlaceholder(
  input: SignXmlInput,
): Promise<SignXmlResult> {
  return {
    ok: true,
    status: "signed",
    signatureMode: "mock",
    signedXml: `${input.xml}\n<!-- MOCK SIGNATURE: tenant=${input.tenantId}; env=${input.environment}; no usar en SII -->`,
  };
}

