import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const migration = readFileSync(
  resolve("migrations/202610040001_cit100_ai_m2m_audit.sql"),
  "utf8",
);

test("M2M audit uses a real service actor, never a fabricated human user", () => {
  assert.match(migration, /alter column user_id drop not null/);
  assert.match(migration, /add column if not exists service_id text/);
  assert.match(
    migration,
    /auth_mode = 'm2m'[\s\S]*?user_id is null[\s\S]*?service_id = 'n8n'/,
  );
  assert.match(
    migration,
    /auth_mode in \('tenant_members', 'platform_admin'\)[\s\S]*?user_id is not null[\s\S]*?service_id is null/,
  );
});

test("M2M audit shares tenant daily quota and concurrency lock", () => {
  assert.match(
    migration,
    /pg_advisory_xact_lock\(hashtext\('citaya-ai:' \|\| p_tenant_id::text\)\)/,
  );
  assert.match(
    migration,
    /when status = 'started' then reserved_tokens[\s\S]*?else total_tokens/,
  );
  assert.match(
    migration,
    /v_used_tokens \+ p_reserved_tokens > p_daily_token_limit/,
  );
});

test("M2M audit is fail-closed to active classified tenants and n8n", () => {
  assert.match(migration, /p_service_id <> 'n8n'/);
  assert.match(migration, /p_workflow_id is null/);
  assert.match(
    migration,
    /p_workflow_id !~ '\^\[A-Za-z0-9\._:-\]\{1,100\}\$'/,
  );
  assert.match(migration, /workflow_id/);
  assert.match(migration, /t\.lifecycle_status = 'active'/);
  assert.match(
    migration,
    /t\.operational_mode in \('demo', 'live', 'internal'\)/,
  );
  assert.match(
    migration,
    /where id = p_request_id[\s\S]*?tenant_id = p_tenant_id[\s\S]*?auth_mode = 'm2m'[\s\S]*?service_id = p_service_id/,
  );
});

test("M2M audit migration contains one canonical copy only", () => {
  assert.equal(
    (migration.match(/create or replace function public\.begin_ai_service_request_audit/g) ?? []).length,
    1,
  );
  assert.equal(
    (migration.match(/create or replace function public\.finish_ai_service_request_audit/g) ?? []).length,
    1,
  );
  assert.equal((migration.match(/commit;/g) ?? []).length, 1);
  assert.match(migration, /p_provider not in \('openai', 'local', 'hybrid'\)/);
});

test("M2M audit RPCs remain service-role only", () => {
  for (const name of [
    "begin_ai_service_request_audit",
    "finish_ai_service_request_audit",
  ]) {
    assert.match(
      migration,
      new RegExp(
        "revoke all on function public\\." +
          name +
          "[\\s\\S]*?from public, anon, authenticated;",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        "grant execute on function public\\." +
          name +
          "[\\s\\S]*?to service_role;",
      ),
    );
  }
});

const state = { calls: [], next: { data: null, error: null } };

class RpcQuery {
  constructor(name, args) {
    this.name = name;
    this.args = args;
  }

  abortSignal(signal) {
    this.signal = signal;
    return this;
  }

  then(resolvePromise, rejectPromise) {
    state.calls.push({
      name: this.name,
      args: this.args,
      signaled: Boolean(this.signal),
    });
    return Promise.resolve(state.next).then(resolvePromise, rejectPromise);
  }
}

globalThis.__citayaM2MAudit = {
  supabaseAdmin: {
    rpc(name, args) {
      return new RpcQuery(name, args);
    },
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabaseAdmin") {
      return { url: "citaya-m2m-audit:supabase", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const file = specifier.slice(2) + ".ts";
      return { url: pathToFileURL(resolve(file)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "citaya-m2m-audit:supabase") {
      return {
        format: "module",
        source:
          "export const supabaseAdmin = globalThis.__citayaM2MAudit.supabaseAdmin;",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const audit = await import(
  pathToFileURL(resolve("lib/ai/server/audit.ts")).href
);

test.beforeEach(() => {
  state.calls = [];
  state.next = { data: null, error: null };
});

test("service audit wrapper sends n8n actor and workflow without user id", async () => {
  state.next = {
    data: "11111111-1111-4111-8111-111111111111",
    error: null,
  };

  const requestId = await audit.beginAIServiceRequestAudit({
    tenantId: "22222222-2222-4222-8222-222222222222",
    productId: "n8n",
    serviceId: "n8n",
    workflowId: "daily-summary",
    provider: "local",
    model: "Qwen/Qwen3-4B-GGUF:Q4_K_M",
    promptVersion: "citaya-n8n-v1",
    dailyTokenLimit: 50000,
    reservedTokens: 800,
  });

  assert.equal(requestId, "11111111-1111-4111-8111-111111111111");
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].name, "begin_ai_service_request_audit");
  assert.equal(state.calls[0].args.p_product_id, "n8n");
  assert.equal(state.calls[0].args.p_service_id, "n8n");
  assert.equal(state.calls[0].args.p_workflow_id, "daily-summary");
  assert.equal("p_user_id" in state.calls[0].args, false);
});

test("service audit wrapper preserves tenant daily-token limit errors", async () => {
  state.next = { data: null, error: { message: "AI_DAILY_TOKEN_LIMIT" } };

  await assert.rejects(
    () =>
      audit.beginAIServiceRequestAudit({
        tenantId: "22222222-2222-4222-8222-222222222222",
        productId: "n8n",
        serviceId: "n8n",
        workflowId: "daily-summary",
        provider: "local",
        model: "local-test",
        promptVersion: "citaya-n8n-v1",
        dailyTokenLimit: 50000,
        reservedTokens: 800,
      }),
    (error) => error?.code === "AI_DAILY_TOKEN_LIMIT",
  );
});

test("service audit finish is bound to tenant plus service actor", async () => {
  state.next = { data: true, error: null };

  await audit.finishAIServiceRequestAudit({
    requestId: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    serviceId: "n8n",
    status: "succeeded",
    toolNames: [],
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    durationMs: 1250,
    route: {
      requestedProvider: "local",
      requestedModel: "local-test",
      effectiveProvider: "local",
      effectiveModel: "local-test",
      fallbackUsed: false,
      providerDurationMs: 900,
    },
  });

  assert.equal(state.calls[0].name, "finish_ai_service_request_audit");
  assert.equal(state.calls[0].args.p_service_id, "n8n");
  assert.equal(state.calls[0].args.p_total_tokens, 120);
  assert.equal("p_user_id" in state.calls[0].args, false);
});
