import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareRealBoleta39Certification } from "../certification/boleta-pre-caf";

function cafMaterial(root: string): {
  cafXml: string;
  cafPrivateKeyPem: string;
  cafPublicKeyPem: string;
  certificatePath: string;
  privateKeyPath: string;
} {
  const privateKeyPath = join(root, "certificate-key.pem");
  const certificatePath = join(root, "certificate.pem");
  const cafKeyPath = join(root, "caf-key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      privateKeyPath,
      "-out",
      certificatePath,
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=Certification Generator Fixture/serialNumber=11111111-1/C=CL",
    ],
    { stdio: "ignore" },
  );
  execFileSync("openssl", ["genrsa", "-out", cafKeyPath, "1024"], {
    stdio: "ignore",
  });
  for (const path of [privateKeyPath, certificatePath, cafKeyPath]) chmodSync(path, 0o600);
  const cafPrivateKeyPem = readFileSync(cafKeyPath, "utf8");
  const key = createPublicKey(createPrivateKey(cafPrivateKeyPem));
  const jwk = key.export({ format: "jwk" }) as { n: string; e: string };
  const cafPublicKeyPem = key.export({ format: "pem", type: "spki" }).toString();
  const da = `<DA><RE>11111111-1</RE><RS>Certification Fixture</RS><TD>39</TD><RNG><D>1</D><H>5</H></RNG><FA>2026-08-03</FA><RSAPK><M>${Buffer.from(jwk.n, "base64url").toString("base64")}</M><E>${Buffer.from(jwk.e, "base64url").toString("base64")}</E></RSAPK><IDK>100</IDK></DA>`;
  const signer = createSign("RSA-SHA1");
  signer.update(da, "latin1");
  const frma = signer.sign(cafPrivateKeyPem, "base64");
  return {
    cafXml: `<CAF version="1.0">${da}<FRMA algoritmo="SHA1withRSA">${frma}</FRMA></CAF>`,
    cafPrivateKeyPem,
    cafPublicKeyPem,
    certificatePath,
    privateKeyPath,
  };
}

test("offline type-39 generator creates and validates five boletas, one envelope and RCOF", async () => {
  const root = mkdtempSync(join(tmpdir(), "citaya-boleta39-real-focal-"));
  const outputDir = join(root, "artifacts");
  try {
    const material = cafMaterial(root);
    const result = await prepareRealBoleta39Certification({
      tenantId: "11111111-1111-4111-8111-111111111111",
      issueDate: "2026-08-03",
      firstFolio: 1,
      outputDir,
      issuer: {
        rut: "11111111-1",
        legalName: "Certification Fixture",
        businessActivity: "Servicios de certificacion",
        address: "Direccion fixture 1",
        commune: "Coquimbo",
        city: "Coquimbo",
        resolutionDate: "2026-08-03",
        resolutionNumber: "0",
        senderRut: "11111111-1",
      },
      ...material,
      generationTimestamp: "2026-08-03T12:00:00",
    });
    assert.equal(result.siiContacted, false);
    assert.equal(result.productionFoliosUsed, false);
    assert.equal(result.artifacts.length, 7);
    assert.deepEqual(result.documents.map((item) => item.folio), [1, 2, 3, 4, 5]);
    assert.deepEqual(result.documents.map((item) => item.totals.totalAmount), [
      29_800,
      2_040,
      4_100,
      14_720,
      3_500,
    ]);
    assert.equal(result.rvdTotals.totalAmount, 54_160);
    assert.equal((result.envelopeXml.match(/<DTE\b/g) ?? []).length, 5);
    assert.equal((result.envelopeXml.match(/<CodRef>SET<\/CodRef>/g) ?? []).length, 5);
    assert.match(result.envelopeXml, /<UnmdItem>Kg<\/UnmdItem>/);
    assert.match(result.envelopeXml, /<IndExe>1<\/IndExe>/);
    assert.doesNotMatch(result.envelopeXml, /<RSASK\b|<AUTORIZACION\b/);
    assert.deepEqual(result.xsd, { boletas: "5/5", envelope: "valid", rcof: "valid" });
    assert.deepEqual(result.signatures, {
      tedFrmt: "5/5",
      boletas: "5/5",
      envelope: "valid",
      rcof: "valid",
    });
    const source = readFileSync(
      join(__dirname, "../certification/boleta-pre-caf.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /from ["']\.\.\/production\//);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /dte_production_|issuance_outbox|finalize_verified_payment/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
