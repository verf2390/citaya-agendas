import assert from "node:assert/strict";
import test from "node:test";

import {
  requestBoletaRestStatus,
} from "../certification/boleta39-rest-api";
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
      rejectionDetails: [],
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
      rejectionDetails: [],
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
      rejectionDetails: [],
    }),
    "rejected",
  );
});

test("official terminal envelope statuses are normalized without contradictory evidence", () => {
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "RPR",
      statistics: [],
      rejectionDetails: [],
    }),
    "accepted_with_observations",
  );
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "RPT",
      statistics: [],
      rejectionDetails: [],
    }),
    "rejected",
  );
  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "VOF",
      statistics: [],
      rejectionDetails: [],
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

  assert.equal(
    deriveSingleBoletaStatusFromTrack({
      dteType: 39,
      envelopeStatus: "EPR",
      statistics: [{ ...type39Accepted, reparos: 1 }],
      rejectionDetails: [],
    }),
    "accepted_with_observations",
  );

  for (const inconsistent of [
    { ...type39Accepted, rechazados: 1 },
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
    "processing",
  );
});

test("matching document detail provides terminal evidence without cross-document contamination", () => {
  const deriveFromDetail = (
    status: string,
    tipo = 39,
    folio: number | null = 40_016,
  ) => deriveSingleBoletaStatusFromTrack({
    dteType: 39,
    expectedFolio: 40_016,
    envelopeStatus: "EPR",
    statistics: [],
    rejectionDetails: [{ tipo, folio, status }],
  });

  assert.equal(deriveFromDetail("DOK"), "accepted");
  assert.equal(deriveFromDetail("RPR"), "accepted_with_observations");
  assert.equal(deriveFromDetail("RCH"), "rejected");
  assert.equal(deriveFromDetail("RCH", 41), "processing");
  assert.equal(deriveFromDetail("RCH", 39, 40_017), "processing");
});

function conclusiveTrackResponse() {
  return new Response(JSON.stringify({
    rut_emisor: "78195645-7",
    trackid: "40016",
    estado: "EPR",
    estadistica: [type39Accepted],
    detalle_rep_rech: [],
    token: "RESPONSE_TOKEN_MUST_NOT_LEAK",
    cookie: "COOKIE_VALUE_MUST_NOT_LEAK",
    body: "BODY_VALUE_MUST_NOT_LEAK",
    headers: "HEADERS_VALUE_MUST_NOT_LEAK",
    certificate: "-----BEGIN CERTIFICATE-----PEM_MUST_NOT_LEAK-----END CERTIFICATE-----",
    url: "https://sii.invalid/status?secret=URL_MUST_NOT_LEAK",
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      Location: "https://sii.invalid/location?secret=LOCATION_MUST_NOT_LEAK",
    },
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
    "pem_must_not_leak",
    "url_must_not_leak",
    "location_must_not_leak",
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

test("normalized detalle_rep_rech resolves the matching Boleta 39 without document fallback", async () => {
  const cases = [
    { code: "DOK", expected: "accepted" },
    { code: "RPR", expected: "accepted_with_observations" },
    { code: "RCH", expected: "rejected" },
  ] as const;

  for (const { code, expected } of cases) {
    let calls = 0;
    const transport = new SiiBoletaApiTransport(
      mockConfig,
      "production",
      async (input) => {
        calls += 1;
        assert.doesNotMatch(String(input), /\/estado(?:\?|$)/);
        return new Response(JSON.stringify({
          estado: "EPR",
          estadistica: [],
          detalle_rep_rech: [{ tipo: 39, folio: 40_016, estado: code }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    const result = await transport.queryStatusManually({
      ...manualStatusInput,
      milestone: async () => undefined,
    });

    assert.equal(result.siiStatus, expected);
    assert.equal(calls, 1);
  }
});

test("an inconclusive valid Track ID response is non-terminal and never calls document status", async () => {
  for (const body of [
    { estado: "EPR", estadistica: [], detalle_rep_rech: [] },
    {
      estado: "EPR",
      estadistica: [{
        ...type39Accepted,
        informados: 2,
        aceptados: 2,
      }],
      detalle_rep_rech: [],
    },
  ]) {
    let documentStatusCalls = 0;
    const mockFetch: typeof fetch = async (input) => {
      if (/\/estado(?:\?|$)/.test(String(input))) {
        documentStatusCalls += 1;
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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

    assert.equal(result.siiStatus, "processing");
    assert.equal(documentStatusCalls, 0);
  }
});

test("Track ID HTTP and content-type failures remain explicit safe errors", async () => {
  const requestWith = (response: Response) => requestBoletaRestStatus({
    environment: "production",
    token: "TRACK_BOUNDARY_TOKEN",
    companyRut: "78195645-7",
    trackId: "40016",
    fetchImpl: async () => response,
  });

  await assert.rejects(
    requestWith(new Response("TOKEN=BODY_SECRET", {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        Location: "https://sii.invalid/?secret=LOCATION_SECRET",
      },
    })),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "BOLETA_REST_STATUS_HTTP_401" &&
      !/token|body|location|https/i.test(error.message),
  );
  await assert.rejects(
    requestWith(new Response("<html>private</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })),
    /BOLETA_REST_STATUS_CONTENT_TYPE_INVALID/,
  );
});
