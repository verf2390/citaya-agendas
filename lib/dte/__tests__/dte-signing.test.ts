import assert from "node:assert/strict";
import test from "node:test";

import {
  signXmlForLab,
  signXmlMockForLab,
} from "../signing/sign-xml.placeholder";
import {
  getRealXmlSigningConfigFromEnv,
  prepareRealXmlSigning,
} from "../signing/sign-xml.real";

test("creates mock XML signature metadata for lab", () => {
  const result = signXmlMockForLab("<Documento>LAB</Documento>", {
    signatureTarget: "Documento",
  });

  assert.equal(result.mode, "mock");
  assert.equal(result.xsdReference, "xmldsignature_v10.xsd");
  assert.equal(result.isProductionValid, false);
  assert.match(result.signedXml, /MOCK-SIGNATURE-LAB-NO-PRODUCTIVO/);
  assert.match(result.signedXml, /Signature/);
});

test("blocks real lab signing without controlled certificate input", async () => {
  await assert.rejects(
    () =>
      signXmlForLab(
        "<Documento>LAB</Documento>",
        { tenantId: "tenant-lab" },
        {
          signatureTarget: "Documento",
          canonicalizationMethod:
            "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
          signatureMethod: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
          digestMethod: "http://www.w3.org/2000/09/xmldsig#sha1",
          includeKeyInfo: true,
          mode: "lab",
        },
      ),
    /controlled test certificate/,
  );
});

test("prepares real XML signing with safe missing-secret status", () => {
  const config = getRealXmlSigningConfigFromEnv("tenant-lab", "Documento");
  const result = prepareRealXmlSigning("<Documento>LAB</Documento>", config);

  assert.equal(result.ok, false);
  assert.equal(result.isProductionValid, false);
  assert.match(result.status, /missing_secret|pending_dependency/);
  assert.ok(result.warnings.some((warning) => warning.includes("PENDIENTE")));
});
