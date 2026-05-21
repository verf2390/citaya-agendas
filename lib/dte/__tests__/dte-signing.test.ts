import assert from "node:assert/strict";
import { validateExternalDteFile } from "../config/external-dte-files";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  signXmlForLab,
  signXmlMockForLab,
} from "../signing/sign-xml.placeholder";
import {
  buildXmlDsigControlled,
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


test("external DTE file validation rejects repo paths and missing files safely", () => {
  const repoPath = "docs/dte-sii/samples/lab-envio-dte.xml";
  const unsafe = validateExternalDteFile({
    envName: "DTE_CAF_PATH",
    pathValue: repoPath,
    repoRoot: process.cwd(),
    allowedExtensions: [".xml"],
  });
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.status, "unsafe_repo_path");

  const missing = validateExternalDteFile({
    envName: "DTE_CERT_PATH",
    pathValue: "/tmp/citaya-missing-cert.pem",
    repoRoot: process.cwd(),
    allowedExtensions: [".pem"],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "missing_external_file");
});

test("XMLDSig preparation blocks missing and unsafe external files", () => {
  const missing = prepareRealXmlSigning("<Documento>LAB</Documento>", {
    tenantId: "tenant-lab",
    signatureTarget: "Documento",
    mode: "certification",
    certificatePath: "/tmp/citaya-missing-cert.pem",
    privateKeyPath: "/tmp/citaya-missing-key.pem",
    publicCertificatePath: "/tmp/citaya-missing-cert.pem",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "missing_secret");

  const unsafe = prepareRealXmlSigning("<Documento>LAB</Documento>", {
    tenantId: "tenant-lab",
    signatureTarget: "Documento",
    mode: "certification",
    certificatePath: "docs/dte-sii/samples/lab-envio-dte.xml",
    privateKeyPath: "docs/dte-sii/samples/lab-envio-dte.xml",
    publicCertificatePath: "docs/dte-sii/samples/lab-envio-dte.xml",
  });
  assert.equal(unsafe.status, "unsafe_repo_path");
});

test("XMLDSig controlled signs with PEM fixtures but remains non-production-valid", () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-dte-xmldsig-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPath = join(root, "private-key.pem");
  const certPath = join(root, "cert.pem");
  writeFileSync(keyPath, privateKey.export({ type: "pkcs1", format: "pem" }).toString(), "utf8");
  writeFileSync(
    certPath,
    ["-----BEGIN CERTIFICATE-----", "QUJDREVGRw==", "-----END CERTIFICATE-----"].join("\n"),
    "utf8",
  );

  const result = buildXmlDsigControlled(
    {
      referenceUri: "Documento-1",
      signedXmlFragment: '<Documento ID="Documento-1">LAB</Documento>',
      mode: "certification",
    },
    {
      tenantId: "tenant-lab",
      signatureTarget: "Documento-1",
      mode: "certification",
      certificatePath: certPath,
      privateKeyPath: keyPath,
      publicCertificatePath: certPath,
    },
  );

  assert.equal(result.mode, "certification");
  assert.equal(result.isProductionValid, false);
  assert.match(result.signatureXml, /<Signature xmlns=/);
  assert.match(result.signatureXml, /<SignatureValue>/);
  assert.doesNotMatch(result.signatureXml, /BEGIN RSA PRIVATE KEY/);
});
