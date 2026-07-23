import assert from "node:assert/strict";
import test from "node:test";

import { selectUniqueCertificationCaf } from "../certification/factura-certification-set-prepare";
import { validateCertificationReissueManifestLineage } from "../certification/factura-certification-set-submit";

const cafs = [
  { typeCode: 33, rangeFrom: 1, rangeTo: 5, name: "33-old" },
  { typeCode: 33, rangeFrom: 6, rangeTo: 8, name: "33-new" },
  { typeCode: 61, rangeFrom: 1, rangeTo: 4, name: "61-old" },
  { typeCode: 61, rangeFrom: 5, rangeTo: 6, name: "61-new" },
  { typeCode: 56, rangeFrom: 1, rangeTo: 2, name: "56-old" },
] as const;
const plan = [
  [33, 5, "33-old"], [33, 6, "33-new"], [33, 7, "33-new"], [33, 8, "33-new"],
  [61, 4, "61-old"], [61, 5, "61-new"], [61, 6, "61-new"], [56, 2, "56-old"],
] as const;

test("FOCAL multi-CAF selecciona exactamente uno por dteType:folio y cobertura", () => {
  for (const [type, folio, expected] of plan)
    assert.equal(selectUniqueCertificationCaf(cafs, type, folio).name, expected);
  assert.throws(
    () => selectUniqueCertificationCaf([...cafs, { typeCode: 33, rangeFrom: 5, rangeTo: 6, name: "overlap" }], 33, 5),
    /Controlled certification preparation failed/,
  );
});

function validManifest(): Record<string, unknown> {
  return {
    artifactKind: "certification_set_reissue",
    reissueNumber: 1,
    reissueReasonCode: "TED-2-510",
    reissueOfEnvelopeSha256: "e8bfb70eb4113c0be7583c76414919ef7044cee944e2d14e52fb12d1e1f8240a",
    reissueOfManifestSha256: "c11e5a0f196dcb83ec91b7648ec8ce4192956356584e74f24a1f9920b3c1f765",
    reissueOfRegistrySha256: "94d8647cd04b5414cb8d923458e9bf95c508de9eeae7f0bdb9ca59268a6e07ef",
    reissueOfTrackIdFingerprint: "f3bc8d8c157d4b83",
    reissueOfStatus: "EPR",
    foliosPlan: "33:5-8,61:4-6,56:2",
    folios: { "33": [5, 6, 7, 8], "56": [2], "61": [4, 5, 6] },
    cafCoverageUnique: "8/8",
    cafAssignments: plan.map(([type, folio, name]) => ({
      dteTypeFolio: `${type}:${folio}`,
      range: name.endsWith("old") ? (type === 33 ? "1-5" : type === 61 ? "1-4" : "1-2") : type === 33 ? "6-8" : "5-6",
    })),
    cafHashes: Array.from({ length: 5 }, (_, index) => ({ sha256: String(index) })),
    officialFrmtValid: "8/8",
    xsiPhysicallyDeclaredOnDte: "8/8",
    literalStandaloneXmlsecValid: "8/8",
    embeddedXmlsecValid: "8/8",
    outerXmlsecValid: true,
    dteXsd: "8/8",
    envioDteXsd: "valid",
    references: "valid",
    totals: "valid",
    encoding: "ISO-8859-1",
    bom: "absent",
    previousArtifactsUnchanged: true,
    previousRegistriesUnchanged: true,
  };
}

test("FOCAL manifest reissue exige linaje honesto y todos los gates", () => {
  const manifest = validManifest();
  assert.equal(validateCertificationReissueManifestLineage(manifest), true);
  assert.equal(validateCertificationReissueManifestLineage({ ...manifest, reissueReasonCode: "otro" }), false);
  assert.equal(validateCertificationReissueManifestLineage({ ...manifest, cafAssignments: [...(manifest.cafAssignments as unknown[]), (manifest.cafAssignments as unknown[])[0]] }), false);
  assert.equal(validateCertificationReissueManifestLineage({ ...manifest, previousRegistriesUnchanged: false }), false);
});
