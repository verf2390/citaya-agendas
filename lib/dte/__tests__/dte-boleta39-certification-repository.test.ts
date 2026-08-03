import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCertificationBoundary,
  InMemoryBoleta39CertificationRepository,
  type CertificationCafImport,
} from "../certification/boleta39-certification-repository";

const CAF: CertificationCafImport = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  environment: "certification",
  documentType: 39,
  issuerRut: "11111111-1",
  cafSha256: "a".repeat(64),
  securePath: "/home/verf/secure/certification/fixture.xml",
  idk: "100",
  rangeFrom: 1,
  rangeTo: 5,
  authorizationDate: "2026-08-03",
  frmaVerificationStatus:
    "not_independently_verified_missing_official_idk100_anchor",
  exceptionReason: "controlled certification-only test authorization",
  exceptionActorId: "22222222-2222-4222-8222-222222222222",
  exceptionAuthorizedAt: "2026-08-03T12:00:00-04:00",
};

test("certification repository requires certification, type 39 and private custody", () => {
  assert.throws(
    () => assertCertificationBoundary({ environment: "production", documentType: 39 }),
    /ENVIRONMENT_REQUIRED/,
  );
  assert.throws(
    () => assertCertificationBoundary({ environment: "certification", documentType: 33 }),
    /TYPE39_REQUIRED/,
  );
  assert.throws(
    () =>
      assertCertificationBoundary({
        environment: "certification",
        documentType: 39,
        securePath: "/tmp/caf.xml",
      }),
    /CAF_PATH_INVALID/,
  );
});

test("certification repository is idempotent and rejects overlap or changed metadata", () => {
  const repository = new InMemoryBoleta39CertificationRepository();
  assert.deepEqual(repository.importCaf(CAF), { replayed: false, folioCount: 5 });
  assert.deepEqual(repository.importCaf(CAF), { replayed: true, folioCount: 5 });
  assert.throws(
    () => repository.importCaf({ ...CAF, issuerRut: "22222222-2" }),
    /REPLAY_METADATA_MISMATCH/,
  );
  assert.throws(
    () => repository.importCaf({ ...CAF, cafSha256: "b".repeat(64) }),
    /RANGE_OVERLAP/,
  );
});

test("folio transitions reserve once and generated folios never become available", () => {
  const repository = new InMemoryBoleta39CertificationRepository();
  repository.importCaf(CAF);
  assert.deepEqual(repository.beginRun("boleta39-certification-fixture-20260803"), {
    replayed: false,
    status: "preparing",
  });
  assert.equal(repository.counts().reserved, 5);
  repository.validateRun();
  assert.equal(repository.counts().generated, 5);
  assert.deepEqual(repository.beginRun("boleta39-certification-fixture-20260803"), {
    replayed: true,
    status: "validated",
  });
  assert.throws(() => repository.forceTransition(1, "available"), /IMMUTABLE/);
});
