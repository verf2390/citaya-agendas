import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const state = { resolved: [], recorded: [] };

globalThis.__citayaWhatsAppIsolation = {
  async resolve(phoneNumberId) {
    state.resolved.push(phoneNumberId);
    if (phoneNumberId !== "111111111") return null;
    return {
      tenantId: TENANT_A,
      phoneNumberId,
      wabaId: "waba-a",
    };
  },
  async record(input) {
    state.recorded.push(input);
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const map = {
      "next/server": "next",
      "@/lib/whatsapp/repository": "repo",
    };
    if (map[specifier]) {
      return { url: `citaya-wa:${map[specifier]}`, shortCircuit: true };
    }
    if (specifier === "@/lib/whatsapp/meta-webhook") {
      return {
        url: pathToFileURL(resolve("lib/whatsapp/meta-webhook.ts")).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const sources = {
      "citaya-wa:next": "export const NextResponse = Response;",
      "citaya-wa:repo": `
        export const resolveWhatsAppTenantByPhoneNumberId =
          globalThis.__citayaWhatsAppIsolation.resolve;
        export const recordWhatsAppWebhookEvent =
          globalThis.__citayaWhatsAppIsolation.record;
      `,
    };
    if (sources[url]) {
      return { format: "module", source: sources[url], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

process.env.CITAYA_WHATSAPP_APP_SECRET = "synthetic-app-secret";
process.env.CITAYA_WHATSAPP_VERIFY_TOKEN = "synthetic-verify-token";

const { GET, POST } = await import(
  pathToFileURL(resolve("app/api/webhooks/whatsapp/route.ts")).href
);

function signedRequest(payload) {
  const rawBody = JSON.stringify(payload);
  const signature =
    "sha256=" +
    createHmac("sha256", process.env.CITAYA_WHATSAPP_APP_SECRET)
      .update(rawBody)
      .digest("hex");
  return new Request(
    "https://app.citaya.online/api/webhooks/whatsapp?tenantId=" + TENANT_B,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signature,
      },
      body: rawBody,
    },
  );
}

test.beforeEach((t) => {
  t.mock.method(console, "error", () => {});
  state.resolved = [];
  state.recorded = [];
});

test("webhook GET verifica challenge sin tenant", async () => {
  const response = await GET(
    new Request(
      "https://app.citaya.online/api/webhooks/whatsapp" +
        "?hub.mode=subscribe" +
        "&hub.verify_token=synthetic-verify-token" +
        "&hub.challenge=abc123",
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "abc123");
});

test("firma inválida bloquea antes de resolver tenant", async () => {
  const response = await POST(
    new Request("https://app.citaya.online/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=bad" },
      body: "{}",
    }),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(state.resolved, []);
  assert.deepEqual(state.recorded, []);
});

test("tenant se resuelve por phone_number_id y no por query/body hints", async () => {
  const response = await POST(
    signedRequest({
      object: "whatsapp_business_account",
      tenantId: TENANT_B,
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "111111111" },
                messages: [
                  {
                    id: "wamid.tenant-safe",
                    from: "56999999999",
                    timestamp: "1790100000",
                    text: { body: "hola" },
                    tenantId: TENANT_B,
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.resolved, ["111111111"]);
  assert.equal(state.recorded.length, 1);
  assert.equal(state.recorded[0].tenantId, TENANT_A);
  assert.notEqual(state.recorded[0].tenantId, TENANT_B);
  assert.equal("text" in state.recorded[0].event, false);
});
