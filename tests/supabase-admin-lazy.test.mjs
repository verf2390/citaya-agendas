import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const source = readFileSync(resolve(repoRoot, "lib/supabaseAdmin.ts"), "utf8");
const modulePath = resolve(repoRoot, "lib/supabaseAdmin.ts");
const supabaseModulePath = require.resolve("@supabase/supabase-js");
const originalTsLoader = require.extensions[".ts"];
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ts = require("typescript");
let createClientCalls = 0;

require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

require.cache[supabaseModulePath] = {
  id: supabaseModulePath,
  filename: supabaseModulePath,
  loaded: true,
  exports: {
    createClient() {
      createClientCalls += 1;
      throw new Error("createClient must not run in missing-secret tests");
    },
  },
  children: [],
  paths: [],
};

test.after(() => {
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
  delete require.cache[modulePath];
  delete require.cache[supabaseModulePath];
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalServiceRole === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  }
});

test("supabaseAdmin imports without a service-role key and initializes only on use", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete require.cache[modulePath];

  const { supabaseAdmin } = require(modulePath);
  assert.equal(createClientCalls, 0);
  assert.throws(
    () => supabaseAdmin.from("tenants"),
    /Cannot initialize supabaseAdmin: missing SUPABASE_SERVICE_ROLE_KEY/,
  );
  assert.equal(createClientCalls, 0);
});

test("supabaseAdmin reports a missing URL explicitly on first real use", () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete require.cache[modulePath];

  const { supabaseAdmin } = require(modulePath);
  assert.throws(
    () => supabaseAdmin.rpc("health_check"),
    /Cannot initialize supabaseAdmin: missing NEXT_PUBLIC_SUPABASE_URL/,
  );
  assert.equal(createClientCalls, 0);
});

test("supabaseAdmin stays server-only, has no public-key fallback, and keeps one lazy singleton", () => {
  assert.doesNotMatch(
    source,
    /SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
  );
  assert.match(
    source,
    /if \(typeof window !== "undefined"\)[\s\S]*supabaseAdmin is server-only/,
  );
  assert.match(source, /let adminClient: SupabaseAdminClient \| null = null;/);
  assert.match(
    source,
    /function getSupabaseAdminClient[\s\S]*if \(adminClient\) return adminClient;/,
  );
  assert.match(
    source,
    /adminClient = createClient\(url, serviceRole,[\s\S]*return adminClient;/,
  );
  assert.match(
    source,
    /new Proxy[\s\S]*const client = getSupabaseAdminClient\(\)/,
  );
  assert.equal(source.match(/createClient\(/g)?.length, 1);
});
