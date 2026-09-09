import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const state = {};
// Exercise the real handler and validator; the existing auth boundary and Storage
// are isolated. This does not assert the helper's internal lookup/auth order.
globalThis.__cit64CampaignUpload = {
  async requireHostTenantAdmin(req) {
    state.events.push("auth:start");
    await Promise.resolve();
    assert.equal(new URL(req.url).hostname, "tenant-a.citaya.test");
    state.events.push("auth:end");
    return state.access;
  },
  supabaseAdmin: {
    from() {
      state.events.push("manual-lookup");
      throw new Error("Unexpected manual tenant lookup");
    },
    storage: {
      from(bucket) {
        state.events.push("storage");
        return {
          async upload(path, bytes, options) {
            state.uploads.push({ bucket, path, bytes, options });
            return { error: state.storageError };
          },
        };
      },
    },
  },
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = {
      "next/server": "cit64-upload:next",
      "@/lib/supabaseAdmin": "cit64-upload:storage",
      "@/lib/api/requireTenantAdmin": "cit64-upload:auth",
    };
    if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolve(specifier.slice(2))).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const sources = {
      "cit64-upload:next": "export const NextResponse = Response;",
      "cit64-upload:storage": "export const supabaseAdmin = globalThis.__cit64CampaignUpload.supabaseAdmin;",
      "cit64-upload:auth": "export const requireHostTenantAdmin = globalThis.__cit64CampaignUpload.requireHostTenantAdmin;",
    };
    if (sources[url]) return { format: "module", source: sources[url], shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { POST } = await import(pathToFileURL(resolve("app/api/admin/campaigns/upload-media/route.ts")).href);

test.beforeEach(() => {
  state.events = [];
  state.uploads = [];
  state.access = { ok: true, tenantId: TENANT_A };
  state.storageError = null;
});

function request(file = new File([png], "image.png", { type: "image/png" }), tenantSlug = "tenant-b") {
  const form = new FormData();
  if (file !== null) form.append("file", file);
  form.append("tenantSlug", tenantSlug);
  const req = new Request("https://tenant-a.citaya.test/api/admin/campaigns/upload-media", { method: "POST", body: form });
  const parse = req.formData.bind(req);
  req.formData = async () => {
    state.events.push("multipart");
    const parsed = await parse();
    const parsedFile = parsed.get("file");
    if (parsedFile instanceof File) {
      const read = parsedFile.arrayBuffer.bind(parsedFile);
      parsedFile.arrayBuffer = async () => {
        state.events.push("bytes");
        return read();
      };
    }
    return parsed;
  };
  return req;
}

for (const status of [401, 403, 400, 500]) {
  test(`CIT-64 upload rejects boundary status ${status} before multipart, manual lookup or Storage`, async () => {
    state.access = { ok: false, status, error: "private authorization details" };
    const response = await POST(request());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, error: status === 401 ? "Unauthorized" : "Forbidden" });
    assert.deepEqual(state.events, ["auth:start", "auth:end"]);
    assert.equal(state.uploads.length, 0);
  });
}

test("CIT-64 upload awaits auth and ignores injected multipart tenantSlug for Storage and URL", async () => {
  const response = await POST(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(state.events, ["auth:start", "auth:end", "multipart", "bytes", "storage"]);
  assert.match(body.fileName, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/);
  assert.equal(state.uploads.length, 1);
  assert.equal(state.uploads[0].path, `campaigns/${TENANT_A}/drafts/${body.fileName}`);
  assert.equal(state.uploads[0].bucket, process.env.SUPABASE_CAMPAIGN_ASSETS_BUCKET?.trim() || "campaign-assets");
  assert.deepEqual(state.uploads[0].bytes, Buffer.from(png));
  assert.deepEqual(state.uploads[0].options, { cacheControl: "31536000", contentType: "image/png", upsert: false });
  assert.deepEqual(body, {
    ok: true, mediaUrl: `https://tenant-a.citaya.test/api/media/campaigns/${TENANT_A}/${body.fileName}`,
    mediaType: "image", fileName: body.fileName, size: png.byteLength, mimeType: "image/png",
  });
});

for (const kind of ["missing", "empty", "oversized", "invalid"]) {
  test(`CIT-64 upload rejects ${kind} file only after auth and never uploads`, async () => {
    const file = kind === "missing" ? null : new File(
      [kind === "oversized" ? new Uint8Array(25 * 1024 * 1024 + 1) : kind === "empty" ? "" : "invalid magic"],
      "image.png", { type: "image/png" },
    );
    const response = await POST(request(file));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "Archivo no permitido" });
    assert.deepEqual(state.events, ["auth:start", "auth:end", "multipart", ...(kind === "invalid" ? ["bytes"] : [])]);
    assert.equal(state.uploads.length, 0);
  });
}

test("CIT-64 upload Storage error returns generic message and logs only error name", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  state.storageError = { name: "StorageError", message: "private storage detail", details: "secret", hint: "internal hint" };
  const response = await POST(request());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, error: "No se pudo guardar el archivo" });
  assert.deepEqual(log.mock.calls[0].arguments, ["[campaign-upload] storage failed", { code: "StorageError" }]);
});

test("CIT-64 upload has no manual tenant resolution or frontend multipart tenant hint", () => {
  const route = readFileSync("app/api/admin/campaigns/upload-media/route.ts", "utf8");
  assert.doesNotMatch(route, /getTenantSlugFromHostname|function hostname|form\.get\("tenantSlug"\)|supabaseAdmin\.from\(/);
  const page = readFileSync("app/admin/campanas/page.tsx", "utf8");
  assert.doesNotMatch(page, /formData\.append\("tenantSlug"/);
});
