import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const route = readFileSync(resolve("app/api/admin/videos/route.ts"), "utf8");
const bridge = readFileSync(resolve("lib/video/studioBridge.ts"), "utf8");
const python = readFileSync(resolve("video-production/backend/bridge.py"), "utf8");

test("video admin authenticates hostname tenant before parsing mutations", () => {
  const authorize = route.slice(
    route.indexOf("async function authorize"),
    route.indexOf("export async function GET"),
  );
  const post = route.slice(route.indexOf("export async function POST"));

  assert.match(authorize, /requireHostTenantAdmin\(req\)/);
  assert.match(post, /const auth = await authorize\(req\)/);
  assert.ok(
    post.indexOf("const auth = await authorize(req)") <
      post.indexOf("req.formData()"),
  );
  assert.ok(
    post.indexOf("const auth = await authorize(req)") <
      post.indexOf("req.json()"),
  );
  assert.match(post, /mutationOriginAllowed\(req\)/);
  assert.match(post, /consumeRateLimit/);
});

test("video admin injects tenant/user from guard and never accepts tenant hints", () => {
  assert.match(route, /tenantId: access\.tenantId/);
  assert.match(route, /userId: access\.userId/);
  assert.doesNotMatch(route, /body\?\.tenantId|form\.get\("tenantId"\)/);
  assert.doesNotMatch(route, /body\?\.userId|form\.get\("userId"\)/);
});

test("video bridge has no shell and Python Actor owns tenant boundary", () => {
  assert.match(bridge, /shell: false/);
  assert.match(bridge, /video-production\/backend\/bridge\.py/);
  assert.match(python, /actor = Actor\(tenant_id, user_id\)/);
  assert.match(python, /WHERE tenant_id=\? AND project_id=\?/);
  assert.doesNotMatch(python, /http\.server|Flask|FastAPI|listen\(/);
});

test("uploads are staged privately and Python rejects paths outside staging", () => {
  assert.match(bridge, /video-production\/storage\/staging/);
  assert.match(bridge, /mode: 0o700/);
  assert.match(bridge, /mode: 0o600/);
  assert.match(python, /path\.is_relative_to\(STAGING_ROOT\)/);
  assert.match(route, /removeStagedUpload\(stagedPath\)/);
});

test("download stays tenant-authorized and private", () => {
  assert.match(route, /action === "download"/);
  assert.match(route, /action: "download_path"/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(route, /X-Content-Type-Options": "nosniff"/);
  assert.doesNotMatch(route, /storage_path/);
});
