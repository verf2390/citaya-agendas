import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSingleBoletaStatusFromTrack,
  SiiBoletaApiTransport,
} from "../production/boleta-api-transport";
import type { ProductionRuntimeConfig } from "../production/config";

const mockConfig: ProductionRuntimeConfig = {
  enabled: true,
  environment: "production",
  signingMode: "production",
  seedUrl: "https://palena.sii.cl/seed",
  tokenUrl: "https://palena.sii.cl/token",
  uploadUrl: "https://palena.sii.cl/upload",
  statusUrl: "https://palena.sii.cl/status",
  storageBucket: "dte-production-private",
  cafRoot: "/tmp/caf",
  certificateRoot: "/tmp/cert",
  privateKeyRoot: "/tmp/cert",
  timeoutMs: 2_000,
};

const type39Accepted = {
  tipo: 39,
  informados: 1,
  aceptados: 1,
  rechazados: 0,
  reparos: 0,
};

test("single-document Track ID statistics derive terminal Boleta 39 statuses", () => {
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "EPR",
      statistics: [type39Accepted],
      rejectionDetails: [],
    }),
    "accepted",
  );
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "EPR",
      statistics: [{
        ...type39Accepted,
        aceptados: 0,
        reparos: 1,
      }],
      rejectionDetails: [{ detail: "sanitized fixture" }],
    }),
    "accepted_with_observations",
  );
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "EPR",
      statistics: [{
        ...type39Accepted,
        aceptados: 0,
        rechazados: 1,
      }],
      rejectionDetails: [{ detail: "sanitized fixture" }],
    }),
    "rejected",
  );
});

test("single-document Track ID processing and envelope rejection states stay explicit", () => {
  for (const envelopeStatus of ["REC", "PRD"]) {
    assert.equal(
      deriveSingleBoletaStatusFromTrack({
        dteType: 39,
        envelopeStatus,
        statistics: [],
        rejectionDetails: [],
      }),
      "processing",
    );
  }
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "RCH",
      statistics: [{
        ...type39Accepted,
        aceptados: 0,
        rechazados: 1,
      }],
      rejectionDetails: [{ detail: "envelope rejected" }],
    }),
    "rejected",
  );
});

test("single-document Track ID refuses non-single and inconsistent counters", () => {
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "EPR",
      statistics: [{
        ...type39Accepted,
        informados: 2,
        aceptados: 2,
      }],
      rejectionDetails: [],
    }),
    null,
  );

  for (const inconsistent of [
    { ...type39Accepted, reparos: 1 },
    { ...type39Accepted, aceptados: -1 },
    { ...type39Accepted, aceptados: Number.NaN },
  ]) {
    assert.equal(
      deriveSingleBoletaStatusFromTrack({
        dteType: 39,
        envelopeStatus: "EPR",
        statistics: [inconsistent],
        rejectionDetails: [],
      }),
      null,
    );
  }
});

test("statistics for another DTE type do not contaminate Boleta 39", () => {
  const type41Rejected = {
    tipo: 41,
    informados: 1,
    aceptados: 0,
    rechazados: 1,
    reparos: 0,
  };
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "EPR",
      statistics: [type41Rejected, type39Accepted],
      rejectionDetails: [],
    }),
    "accepted",
  );
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "EPR",
      statistics: [type41Rejected],
      rejectionDetails: [],
    }),
    null,
  );
});

function conclusiveTrackResponse() {
  return new Response(JSON.stringify({
    rut_emisor: "78195645-7",
    trackid: "40016",
    estado: "EPR",
    estadisticas: [type39Accepted],
    detalle_rep_rech: [],
    token: "RESPONSE_TOKEN_MUST_NOT_LEAK",
    cookie: "COOKIE_VALUE_MUST_NOT_LEAK",
    body: "BODY_VALUE_MUST_NOT_LEAK",
    headers: "HEADERS_VALUE_MUST_NOT_LEAK",
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const manualStatusInput = {
  trackId: "40016",
  token: "REQUEST_TOKEN_MUST_NOT_LEAK",
  companyRut: "78195645-7",
  document: {
    dteType: 39 as const,
    folio: 40_016,
    recipientRut: "66666666-6",
    amount: 25_000,
    issueDate: "2026-08-10",
  },
};

test("a conclusive Track ID acceptance skips the individual document endpoint", async () => {
  const requestedUrls: string[] = [];
  const milestones: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith("/estado")) {
      throw new Error("INDIVIDUAL_DOCUMENT_STATUS_MUST_NOT_BE_CALLED");
    }
    return conclusiveTrackResponse();
  };
  const transport = new SiiBoletaApiTransport(
    mockConfig,
    "production",
    mockFetch,
  );

  const result = await transport.queryStatusManually({
    ...manualStatusInput,
    milestone: async (event) => {
      milestones.push(event);
    },
  });

  assert.equal(result.siiStatus, "accepted");
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /boleta\.electronica\.envio/);
  assert.doesNotMatch(requestedUrls[0], /\/estado(?:\?|$)/);
  assert.deepEqual(milestones, ["status_before_fetch", "status_after_fetch"]);

  const persistedSafeData = JSON.stringify({
    responseSafe: result.responseSafe,
    responseBytes: result.responseBytes?.toString("utf8"),
  }).toLowerCase();
  for (const forbidden of [
    "request_token_must_not_leak",
    "response_token_must_not_leak",
    "cookie_value_must_not_leak",
    "body_value_must_not_leak",
    "headers_value_must_not_leak",
    "\"token\"",
    "\"cookie\"",
    "\"body\"",
    "\"headers\"",
  ]) {
    assert.equal(persistedSafeData.includes(forbidden), false);
  }
});

test("an individual endpoint 401 cannot destroy a conclusive Track ID acceptance", async () => {
  let documentStatusCalls = 0;
  const mockFetch: typeof fetch = async (input) => {
    if (/\/estado(?:\?|$)/.test(String(input))) {
      documentStatusCalls += 1;
      return new Response("unauthorized", { status: 401 });
    }
    return conclusiveTrackResponse();
  };
  const transport = new SiiBoletaApiTransport(
    mockConfig,
    "production",
    mockFetch,
  );

  const result = await transport.queryStatusManually({
    ...manualStatusInput,
    milestone: async () => undefined,
  });

  assert.equal(result.siiStatus, "accepted");
  assert.equal(documentStatusCalls, 0);
});
