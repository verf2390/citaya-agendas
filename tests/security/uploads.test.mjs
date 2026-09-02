import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCampaignMedia } from "../../lib/security/upload-validation.mjs";

const png = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);

test("valid image is accepted from magic bytes", () => {
  const result = validateCampaignMedia({ bytes: png, declaredMime: "image/png", originalName: "image.png" });
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, "image/png");
});

test("fake MIME, invalid magic, oversized and active content are rejected", () => {
  assert.equal(validateCampaignMedia({ bytes: png, declaredMime: "image/jpeg", originalName: "x.jpg" }).reason, "magic_mismatch");
  assert.equal(validateCampaignMedia({ bytes: Uint8Array.from([1,2,3]), declaredMime: "image/png", originalName: "x.png" }).reason, "magic_mismatch");
  assert.equal(validateCampaignMedia({ bytes: new Uint8Array(5 * 1024 * 1024 + 1).fill(1), declaredMime: "image/png", originalName: "x.png" }).reason, "too_large");
  const active = Buffer.concat([Buffer.from(png), Buffer.from("<script>alert(1)</script>")]);
  assert.equal(validateCampaignMedia({ bytes: active, declaredMime: "image/png", originalName: "x.png" }).reason, "active_content");
  assert.equal(validateCampaignMedia({ bytes: Buffer.from("<svg><script/></svg>"), declaredMime: "image/svg+xml", originalName: "x.svg" }).ok, false);
});

test("path traversal name is never used as storage path", () => {
  const route = readFileSync(new URL("../../app/api/admin/campaigns/upload-media/route.ts", import.meta.url), "utf8");
  const servingRoute = readFileSync(new URL("../../app/api/media/campaigns/[...path]/route.ts", import.meta.url), "utf8");
  assert.match(route, /randomUUID\(\)/);
  assert.doesNotMatch(route, /storagePath[^\n]*file\.name/);
  assert.match(route, /\/api\/media\/campaigns\//);
  assert.match(servingRoute, /X-Content-Type-Options.*nosniff/);
  assert.match(servingRoute, /SERVER_FILE/);
  assert.equal(validateCampaignMedia({ bytes: png, declaredMime: "image/png", originalName: "../../evil.png" }).ok, true);
});
