import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(resolve(path), "utf8");

test("AI Core mantiene secretos server-side y OpenAI store=false", () => {
  const factory = read("lib/ai/provider-factory.ts");
  const provider = read("lib/ai/providers/openai.ts");
  assert.match(factory, /process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(factory, /NEXT_PUBLIC_OPENAI/);
  assert.match(factory, /server-only/);
  assert.match(provider, /store: false/);
  assert.match(provider, /parallel_tool_calls: false/);
});

test("auditoría no crea columnas para prompts, respuestas o resultados", () => {
  const migration = read(
    "migrations/202609220001_citaya_ai_core_foundation.sql",
  );
  const table = migration.slice(
    migration.indexOf("create table if not exists public.ai_request_audit"),
    migration.indexOf("create index if not exists ai_request_audit"),
  );
  assert.doesNotMatch(table, /\bprompt\s+(text|jsonb)/i);
  assert.doesNotMatch(table, /\bresponse\s+(text|jsonb)/i);
  assert.doesNotMatch(table, /\btool_results?\s+(text|jsonb)/i);
  assert.match(migration, /alter table public\.ai_request_audit enable row level security/);
  assert.match(migration, /revoke all on public\.ai_request_audit from anon, authenticated/);
  assert.match(migration, /is_tenant_member\(p_tenant_id, p_user_id\)/);
  assert.match(
    migration,
    /p_auth_mode = 'tenant_members'[\s\S]*?not public\.is_tenant_member\(p_tenant_id, p_user_id\)/,
  );
  assert.match(
    migration,
    /p_auth_mode = 'platform_admin'[\s\S]*?not public\.is_platform_admin\(p_user_id\)/,
  );
  assert.match(migration, /greatest\(total_tokens, reserved_tokens\)/);
});

test("prompt version is configurable only through the known-version registry", () => {
  const policy = read("lib/ai/server/tenant-policy.ts");
  const prompts = read("lib/ai/prompts/citaya-app-v1.ts");
  assert.match(policy, /CITAYA_AI_PROMPT_VERSION/);
  assert.match(policy, /assertCitayaAppPromptVersion/);
  assert.match(prompts, /citaya-app-assistant-v1/);
});


test("el deadline total cubre auditoría y ejecución del asistente", () => {
  const assistant = read("lib/ai/server/citaya-app-assistant.ts");
  const audit = read("lib/ai/server/audit.ts");

  assert.match(assistant, /const deadlineController = new AbortController\(\)/);
  assert.match(
    assistant,
    /beginAIRequestAudit\([\s\S]*?signal: deadlineController\.signal/,
  );
  assert.match(
    assistant,
    /timeoutMs: remainingTimeoutMs[\s\S]*?finishAIRequestAudit\([\s\S]*?signal: deadlineController\.signal/,
  );
  assert.match(audit, /query\.abortSignal\(input\.signal\)/);
  assert.match(audit, /input\.signal\?\.aborted/);
  assert.match(audit, /"AI_TIMEOUT"/);
});
