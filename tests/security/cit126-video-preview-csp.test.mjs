import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync("next.config.ts", "utf8");

test("Video Studio preview CSP allows only local/blob media", () => {
  assert.match(config, /"media-src 'self' blob:"/);
  assert.doesNotMatch(config, /media-src[^\n]*https:\/\//);
});
