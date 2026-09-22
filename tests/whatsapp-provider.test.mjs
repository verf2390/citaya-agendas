import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const { MetaCloudWhatsAppProvider } = await import(
  pathToFileURL(resolve("lib/whatsapp/providers/meta-cloud.ts")).href
);

test("provider Meta construye un envío template server-side", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({ messages: [{ id: "wamid.synthetic-1" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const provider = new MetaCloudWhatsAppProvider({
    accessToken: "synthetic-access-token-1234567890",
    phoneNumberId: "123456789",
    graphVersion: "v99.0",
  });

  const result = await provider.sendTemplate({
    to: "+56 9 1234 5678",
    templateName: "booking_confirmation",
    languageCode: "es_CL",
  });

  assert.equal(result.providerMessageId, "wamid.synthetic-1");
  assert.equal(
    calls[0].url,
    "https://graph.facebook.com/v99.0/123456789/messages",
  );
  assert.equal(
    calls[0].init.headers.Authorization,
    "Bearer synthetic-access-token-1234567890",
  );
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.to, "56912345678");
  assert.equal(body.type, "template");
  assert.equal(body.template.name, "booking_confirmation");
});

test("provider Meta rechaza destinatarios y templates inválidos", async () => {
  const provider = new MetaCloudWhatsAppProvider({
    accessToken: "synthetic-access-token-1234567890",
    phoneNumberId: "123456789",
    graphVersion: "v99.0",
  });

  await assert.rejects(
    provider.sendTemplate({
      to: "123",
      templateName: "booking_confirmation",
      languageCode: "es_CL",
    }),
    /Destinatario WhatsApp inválido/,
  );
  await assert.rejects(
    provider.sendTemplate({
      to: "foo+56912345678",
      templateName: "booking_confirmation",
      languageCode: "es_CL",
    }),
    /Destinatario WhatsApp inválido/,
  );
  await assert.rejects(
    provider.sendTemplate({
      to: "56912345678",
      templateName: "BAD TEMPLATE",
      languageCode: "es_CL",
    }),
    /Template WhatsApp inválido/,
  );
});
