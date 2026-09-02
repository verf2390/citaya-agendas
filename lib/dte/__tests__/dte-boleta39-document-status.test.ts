import assert from "node:assert/strict";
import test from "node:test";

import { requestBoletaRestDocumentStatus } from "../certification/boleta39-rest-api";

const secretToken = "SECRETTOKEN123";
const sensitiveBody =
  "TOKEN=BODY_SECRET Cookie=session body=<html>private response</html>";
const sensitiveLocation = "https://sii.invalid/private/status?token=LOCATION_SECRET";

function requestWith(response: Response) {
  return requestBoletaRestDocumentStatus({
    environment: "production",
    token: secretToken,
    companyRut: "78195645-7",
    dteType: 39,
    folio: 40_016,
    recipientRut: "66666666-6",
    amount: 25_000,
    issueDate: "2026-08-10",
    fetchImpl: async () => response,
    timeoutMs: 2_000,
  });
}

async function assertSafeFailure(
  status: number,
  contentType: string,
  expectedCode: string,
): Promise<void> {
  const response = new Response(sensitiveBody, {
    status,
    headers: {
      "Content-Type": contentType,
      Location: sensitiveLocation,
      "Set-Cookie": "TOKEN=COOKIE_SECRET",
    },
  });

  await assert.rejects(requestWith(response), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, expectedCode);
    for (const sensitiveValue of [
      sensitiveBody,
      sensitiveLocation,
      secretToken,
      "BODY_SECRET",
      "LOCATION_SECRET",
      "COOKIE_SECRET",
      "Cookie",
      "<html>",
      "https://",
    ]) {
      assert.equal(
        error.message.toLowerCase().includes(sensitiveValue.toLowerCase()),
        false,
      );
    }
    return true;
  });
}

test("document status reports HTTP 302 without response details", async () => {
  await assertSafeFailure(
    302,
    "text/html",
    "BOLETA_REST_DOCUMENT_STATUS_HTTP_302",
  );
});

test("document status reports HTTP 403 without response details", async () => {
  await assertSafeFailure(
    403,
    "text/html",
    "BOLETA_REST_DOCUMENT_STATUS_HTTP_403",
  );
});

test("document status prioritizes HTTP 500 over JSON content type", async () => {
  await assertSafeFailure(
    500,
    "application/json",
    "BOLETA_REST_DOCUMENT_STATUS_HTTP_500",
  );
});

test("document status rejects HTTP 200 with non-JSON content type", async () => {
  await assertSafeFailure(
    200,
    "text/html",
    "BOLETA_REST_DOCUMENT_STATUS_CONTENT_TYPE_INVALID",
  );
});

test("document status preserves valid HTTP 200 JSON parsing", async () => {
  const result = await requestWith(new Response(
    JSON.stringify({ codigo: "dok", descripcion: "Documento aceptado" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    },
  ));

  assert.equal(result.httpStatus, 200);
  assert.equal(result.contentType, "application/json; charset=UTF-8");
  assert.equal(result.data.code, "DOK");
  assert.deepEqual(result.sanitizedJson, {
    codigo: "dok",
    descripcion: "Documento aceptado",
  });
});
