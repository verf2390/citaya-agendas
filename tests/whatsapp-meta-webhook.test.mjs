import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const {
  extractMetaWebhookEvents,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} = await import(
  pathToFileURL(resolve("lib/whatsapp/meta-webhook.ts")).href
);

test("Meta webhook challenge exige token exacto", () => {
  assert.equal(
    verifyMetaWebhookChallenge({
      mode: "subscribe",
      verifyToken: "token-seguro",
      challenge: "12345",
      expectedVerifyToken: "token-seguro",
    }),
    "12345",
  );
  assert.equal(
    verifyMetaWebhookChallenge({
      mode: "subscribe",
      verifyToken: "otro",
      challenge: "12345",
      expectedVerifyToken: "token-seguro",
    }),
    null,
  );
});

test("Meta webhook valida x-hub-signature-256 sobre raw body", () => {
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
  const appSecret = "synthetic-meta-app-secret";
  const signature =
    "sha256=" +
    createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  assert.equal(
    verifyMetaWebhookSignature({
      rawBody,
      signatureHeader: signature,
      appSecret,
    }),
    true,
  );
  assert.equal(
    verifyMetaWebhookSignature({
      rawBody: rawBody + " ",
      signatureHeader: signature,
      appSecret,
    }),
    false,
  );
});

test("parser extrae solo metadata segura de mensajes y delivery", () => {
  const events = extractMetaWebhookEvents({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "123456789" },
              messages: [
                {
                  id: "wamid.inbound-1",
                  from: "56911111111",
                  timestamp: "1790100000",
                  text: { body: "dato sensible que no debe persistirse" },
                },
              ],
              statuses: [
                {
                  id: "wamid.outbound-1",
                  status: "delivered",
                  timestamp: "1790100001",
                  recipient_id: "56922222222",
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map(({ direction, eventType, providerMessageId }) => ({
      direction,
      eventType,
      providerMessageId,
    })),
    [
      {
        direction: "inbound",
        eventType: "message",
        providerMessageId: "wamid.inbound-1",
      },
      {
        direction: "status",
        eventType: "delivered",
        providerMessageId: "wamid.outbound-1",
      },
    ],
  );
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /dato sensible/);
  assert.doesNotMatch(serialized, /56911111111|56922222222/);
  assert.match(events[0].eventKey, /^[0-9a-f]{64}$/);
});

test("parser ignora objetos ajenos a WhatsApp messages", () => {
  assert.deepEqual(extractMetaWebhookEvents({ object: "page", entry: [] }), []);
  assert.deepEqual(extractMetaWebhookEvents(null), []);
});


test("timestamp inválido conserva una clave idempotente determinista", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "123456789" },
              statuses: [
                {
                  id: "wamid.bad-time",
                  status: "delivered",
                  timestamp: "not-a-number",
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const first = extractMetaWebhookEvents(payload)[0];
  const second = extractMetaWebhookEvents(payload)[0];
  assert.equal(first.occurredAt, "1970-01-01T00:00:00.000Z");
  assert.equal(first.eventKey, second.eventKey);
});
