import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();

test("agenda PostgREST select has no trailing field comma", () => {
  const source = readFileSync(resolve(root, "app/api/admin/appointments/range/route.ts"), "utf8");
  const selectBody = source.match(/\.select\(\s*`([\s\S]*?)`\s*,?\s*\)/)?.[1];
  assert.ok(selectBody);
  assert.match(selectBody, /payment_url\s*$/);
  assert.doesNotMatch(selectBody, /,\s*$/);
});

test("professional avatar accepts trusted URL and rejects untrusted URL", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://trusted.supabase.co";
  const { trustedProfessionalAvatarUrl } = await import("../lib/media/professional-avatar.mjs");
  assert.match(trustedProfessionalAvatarUrl("https://images.unsplash.com/photo.jpg", "https://demo.citaya.online"), /^https:\/\/images\.unsplash\.com\//);
  assert.equal(trustedProfessionalAvatarUrl("https://evil.example/photo.jpg", "https://demo.citaya.online"), null);
});

test("professional avatar uses stable initials when absent or failed", async () => {
  const { professionalAvatarState } = await import("../lib/media/professional-avatar.mjs");
  assert.deepEqual(professionalAvatarState({ url: null, failed: false, name: "Camila Torres" }), { src: null, initials: "CT", showImage: false });
  const failed = professionalAvatarState({ url: "https://images.unsplash.com/photo.jpg", failed: true, name: "Felipe Rojas", origin: "https://demo.citaya.online" });
  assert.equal(failed.showImage, false);
  assert.equal(failed.initials, "FR");
});
