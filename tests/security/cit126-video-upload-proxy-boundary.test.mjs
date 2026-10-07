import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxy = readFileSync("proxy.ts", "utf8");

test("API routes bypass Next Proxy so Video Studio can receive large multipart uploads", () => {
  assert.ok(
    proxy.includes('matcher: ["/((?!api(?:/|$)).*)"]'),
    "Proxy matcher must exclude /api and /api/* routes",
  );
  assert.match(proxy, /API routes handle their own auth/);
});

test("admin pages remain covered by Proxy", () => {
  assert.match(proxy, /pathname\.startsWith\(["']\/admin["']\)/);
});
