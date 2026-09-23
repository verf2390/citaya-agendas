import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return {
        url: pathToFileURL(resolve(`${specifier.slice(2)}.ts`)).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { runAICore } = await import(
  pathToFileURL(resolve("lib/ai/core.ts")).href
);
const { OpenAIProvider } = await import(
  pathToFileURL(resolve("lib/ai/providers/openai.ts")).href
);
const { LocalModelProvider } = await import(
  pathToFileURL(resolve("lib/ai/providers/local.ts")).href
);
const { HybridAIProvider } = await import(
  pathToFileURL(resolve("lib/ai/providers/hybrid.ts")).href
);
const { AIError } = await import(
  pathToFileURL(resolve("lib/ai/errors.ts")).href
);

const context = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  tenantSlug: "tenant-a",
  timezone: "America/Santiago",
  now: new Date("2026-09-22T12:00:00Z"),
};

const definition = {
  name: "count_appointments",
  description: "Cuenta reservas",
  inputSchema: {
    type: "object",
    properties: { date: { type: "string" } },
    required: ["date"],
    additionalProperties: false,
  },
};

test("AI Core ejecuta solo la tool registrada y agrega uso", async () => {
  const calls = [];
  const provider = {
    id: "openai",
    model: "test-model",
    async generate(request) {
      calls.push(request);
      if (calls.length === 1) {
        return {
          text: "",
          toolCalls: [
            {
              id: "call-1",
              name: "count_appointments",
              arguments: { date: "2026-09-23" },
            },
          ],
          continuation: { turn: 1 },
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        };
      }
      assert.deepEqual(request.input, [
        {
          type: "tool_result",
          callId: "call-1",
          output: { active: 3 },
        },
      ]);
      assert.deepEqual(request.continuation, { turn: 1 });
      return {
        text: "Tienes 3 reservas mañana.",
        toolCalls: [],
        usage: { inputTokens: 8, outputTokens: 6, totalTokens: 14 },
      };
    },
  };
  const result = await runAICore({
    provider,
    instructions: "Solo lectura",
    message: "¿Cuántas reservas tengo mañana?",
    tools: [
      {
        definition,
        async execute(args, toolContext) {
          assert.deepEqual(args, { date: "2026-09-23" });
          assert.equal(toolContext.tenantId, context.tenantId);
          return { active: 3 };
        },
      },
    ],
    context,
    maxOutputTokens: 500,
    timeoutMs: 1_000,
  });

  assert.equal(result.text, "Tienes 3 reservas mañana.");
  assert.deepEqual(result.toolsUsed, ["count_appointments"]);
  assert.deepEqual(result.usage, {
    inputTokens: 18,
    outputTokens: 10,
    totalTokens: 28,
  });
  assert.equal(result.steps, 2);
  assert.equal(result.route.requestedProvider, "openai");
  assert.equal(result.route.effectiveProvider, "openai");
  assert.equal(result.route.requestedModel, "test-model");
  assert.equal(result.route.effectiveModel, "test-model");
  assert.equal(result.route.fallbackUsed, false);
  assert.ok(result.route.providerDurationMs >= 0);
});

test("AI Core puede cerrar una consulta determinística tras una sola llamada al provider", async () => {
  let providerCalls = 0;
  const provider = {
    id: "local",
    model: "test-model",
    async generate() {
      providerCalls += 1;
      return {
        text: "",
        toolCalls: [
          {
            id: "call-fast",
            name: "count_appointments",
            arguments: { date: "2026-09-23" },
          },
        ],
        continuation: { turn: 1 },
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      };
    },
  };

  const result = await runAICore({
    provider,
    instructions: "Solo lectura",
    message: "¿Cuántas reservas tengo mañana?",
    tools: [
      {
        definition,
        async execute() {
          return { active: 3, canceled: 0, total: 3 };
        },
        directResponse({ message, output }) {
          assert.equal(message, "¿Cuántas reservas tengo mañana?");
          assert.deepEqual(output, { active: 3, canceled: 0, total: 3 });
          return "Mañana tienes 3 reservas activas y 0 canceladas. Total: 3.";
        },
      },
    ],
    context,
    maxOutputTokens: 500,
    timeoutMs: 1_000,
  });

  assert.equal(providerCalls, 1);
  assert.equal(result.steps, 1);
  assert.equal(
    result.text,
    "Mañana tienes 3 reservas activas y 0 canceladas. Total: 3.",
  );
  assert.deepEqual(result.toolsUsed, ["count_appointments"]);
  assert.deepEqual(result.usage, {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
  });
});

test("AI Core entrega historial acotado al proveedor sin persistirlo", async () => {
  const provider = {
    id: "local",
    model: "test-model",
    async generate(request) {
      assert.deepEqual(request.input, [
        { type: "user", text: "Busca inactivos de 60 días" },
        { type: "assistant", text: "Encontré 4 clientes." },
        { type: "user", text: "Redáctame un mensaje para ellos" },
      ]);
      return {
        text: "Borrador listo.",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      };
    },
  };
  const result = await runAICore({
    provider,
    instructions: "Solo lectura",
    history: [
      { role: "user", text: "Busca inactivos de 60 días" },
      { role: "assistant", text: "Encontré 4 clientes." },
    ],
    message: "Redáctame un mensaje para ellos",
    tools: [],
    context,
    maxOutputTokens: 500,
    timeoutMs: 1_000,
  });
  assert.equal(result.text, "Borrador listo.");
});

test("AI Core rechaza una tool fuera de la allow-list", async () => {
  const provider = {
    id: "openai",
    model: "test-model",
    async generate() {
      return {
        text: "",
        toolCalls: [
          { id: "call-1", name: "cancel_appointment", arguments: {} },
        ],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  };

  await assert.rejects(
    runAICore({
      provider,
      instructions: "Solo lectura",
      message: "Cancela todo",
      tools: [{ definition, async execute() {} }],
      context,
      maxOutputTokens: 500,
      timeoutMs: 1_000,
    }),
    (error) => error?.code === "AI_TOOL_NOT_ALLOWED",
  );
});

test("AI Core aplica el timeout total mientras una tool está ejecutándose", async () => {
  const provider = {
    id: "openai",
    model: "test-model",
    async generate() {
      return {
        text: "",
        toolCalls: [
          { id: "call-1", name: "count_appointments", arguments: {} },
        ],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  };
  const startedAt = Date.now();

  await assert.rejects(
    runAICore({
      provider,
      instructions: "Solo lectura",
      message: "Cuenta mis reservas",
      tools: [
        {
          definition,
          execute: () => new Promise(() => {}),
        },
      ],
      context,
      maxOutputTokens: 500,
      timeoutMs: 20,
    }),
    (error) => error?.code === "AI_TIMEOUT",
  );
  assert.ok(Date.now() - startedAt < 1_000);
});

test("OpenAIProvider usa Responses API sin persistencia y schemas estrictos", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "function_call",
            call_id: "call-1",
            name: "count_appointments",
            arguments: '{"date":"2026-09-23"}',
          },
        ],
        usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const provider = new OpenAIProvider({
    apiKey: "synthetic-test-key",
    model: "test-model",
  });
  const turn = await provider.generate({
    instructions: "Solo lectura",
    input: [{ type: "user", text: "Reservas mañana" }],
    tools: [definition],
    maxOutputTokens: 400,
    signal: new AbortController().signal,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].store, false);
  assert.deepEqual(requests[0].include, ["reasoning.encrypted_content"]);
  assert.equal(requests[0].parallel_tool_calls, false);
  assert.equal(requests[0].tools[0].strict, true);
  assert.equal(requests[0].max_output_tokens, 400);
  assert.deepEqual(turn.toolCalls, [
    {
      id: "call-1",
      name: "count_appointments",
      arguments: { date: "2026-09-23" },
    },
  ]);
  assert.deepEqual(turn.usage, {
    inputTokens: 7,
    outputTokens: 3,
    totalTokens: 10,
  });
});


test("OpenAIProvider rechaza endpoints HTTP remotos", () => {
  assert.throws(
    () =>
      new OpenAIProvider({
        apiKey: "synthetic-test-key",
        model: "test-model",
        endpoint: "http://example.com/v1/responses",
      }),
    (error) => error?.code === "AI_PROVIDER_CONFIG",
  );

  assert.doesNotThrow(
    () =>
      new OpenAIProvider({
        apiKey: "synthetic-test-key",
        model: "test-model",
        endpoint: "http://127.0.0.1:8787/v1/responses",
      }),
  );
});

test("LocalModelProvider normaliza el uso de tokens reportado", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    return new Response(
      JSON.stringify({
        text: "OK",
        toolCalls: [],
        usage: {
          inputTokens: 2.9,
          outputTokens: 3.7,
          totalTokens: 1,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const provider = new LocalModelProvider({
    endpoint: "http://127.0.0.1:8787/ai",
    model: "local-test",
  });
  const turn = await provider.generate({
    instructions: "Solo lectura",
    input: [{ type: "user", text: "Hola" }],
    tools: [],
    maxOutputTokens: 100,
    signal: new AbortController().signal,
  });

  assert.deepEqual(turn.usage, {
    inputTokens: 2,
    outputTokens: 3,
    totalTokens: 5,
  });
});


test("LocalModelProvider exige autenticación fuera de loopback", () => {
  assert.throws(
    () =>
      new LocalModelProvider({
        endpoint: "https://ai.internal.example/gateway",
        model: "local-test",
      }),
    (error) => error?.code === "AI_PROVIDER_CONFIG",
  );

  assert.doesNotThrow(
    () =>
      new LocalModelProvider({
        endpoint: "https://ai.internal.example/gateway",
        model: "local-test",
        authToken: "synthetic-token",
      }),
  );
});


test("LocalModelProvider exige opt-in y token para HTTP en LAN privada", () => {
  assert.throws(
    () =>
      new LocalModelProvider({
        endpoint: "http://192.168.1.50:8787/v1/generate",
        model: "local-test",
        authToken: "synthetic-token",
      }),
    (error) => error?.code === "AI_PROVIDER_CONFIG",
  );

  assert.throws(
    () =>
      new LocalModelProvider({
        endpoint: "http://192.168.1.50:8787/v1/generate",
        model: "local-test",
        allowPrivateHttp: true,
      }),
    (error) => error?.code === "AI_PROVIDER_CONFIG",
  );

  assert.doesNotThrow(
    () =>
      new LocalModelProvider({
        endpoint: "http://192.168.1.50:8787/v1/generate",
        model: "local-test",
        authToken: "synthetic-token",
        allowPrivateHttp: true,
      }),
  );
});


test("HybridAIProvider usa local y queda sticky tras un primer turno exitoso", async () => {
  const calls = [];
  const primary = {
    id: "local",
    model: "local-test",
    async generate(request) {
      calls.push("local");
      return {
        text: "local",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  };
  const fallback = {
    id: "openai",
    model: "cloud-test",
    async generate() {
      calls.push("cloud");
      return {
        text: "cloud",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  };
  const provider = new HybridAIProvider(primary, fallback, 250);
  const request = {
    instructions: "x",
    input: [{ type: "user", text: "hola" }],
    tools: [],
    maxOutputTokens: 100,
    signal: new AbortController().signal,
  };

  assert.equal((await provider.generate(request)).text, "local");
  assert.equal((await provider.generate(request)).text, "local");
  assert.deepEqual(calls, ["local", "local"]);
});

test("HybridAIProvider hace fallback solo antes del primer turno exitoso", async () => {
  const calls = [];
  const primary = {
    id: "local",
    model: "local-test",
    async generate() {
      calls.push("local");
      throw new AIError("AI_PROVIDER_UNAVAILABLE", "local down");
    },
  };
  const fallback = {
    id: "openai",
    model: "cloud-test",
    async generate() {
      calls.push("cloud");
      return {
        text: "cloud",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  };
  const provider = new HybridAIProvider(primary, fallback, 250);
  const request = {
    instructions: "x",
    input: [{ type: "user", text: "hola" }],
    tools: [],
    maxOutputTokens: 100,
    signal: new AbortController().signal,
  };

  const first = await provider.generate(request);
  const second = await provider.generate(request);
  assert.equal(first.text, "cloud");
  assert.equal(first.route.effectiveProvider, "openai");
  assert.equal(first.route.fallbackUsed, true);
  assert.equal(second.text, "cloud");
  assert.equal(second.route.effectiveProvider, "openai");
  assert.equal(second.route.fallbackUsed, true);
  assert.deepEqual(calls, ["local", "cloud", "cloud"]);
});

test("HybridAIProvider abandona un local lento sin consumir el deadline global", async () => {
  const primary = {
    id: "local",
    model: "local-test",
    async generate(request) {
      return new Promise((resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    },
  };
  const fallback = {
    id: "openai",
    model: "cloud-test",
    async generate() {
      return {
        text: "cloud",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  };
  const provider = new HybridAIProvider(primary, fallback, 250);
  const startedAt = Date.now();
  const turn = await provider.generate({
    instructions: "x",
    input: [{ type: "user", text: "hola" }],
    tools: [],
    maxOutputTokens: 100,
    signal: new AbortController().signal,
  });

  assert.equal(turn.text, "cloud");
  assert.ok(Date.now() - startedAt < 500);
});

test("HybridAIProvider no cambia de proveedor después de iniciar un tool loop", async () => {
  let call = 0;
  const primary = {
    id: "local",
    model: "local-test",
    async generate() {
      call += 1;
      if (call === 1) {
        return {
          text: "",
          toolCalls: [{ id: "c1", name: "x", arguments: {} }],
          continuation: { local: true },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      throw new AIError("AI_PROVIDER_UNAVAILABLE", "local failed later");
    },
  };
  let cloudCalls = 0;
  const fallback = {
    id: "openai",
    model: "cloud-test",
    async generate() {
      cloudCalls += 1;
      return {
        text: "cloud",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  };
  const provider = new HybridAIProvider(primary, fallback, 250);
  const signal = new AbortController().signal;

  await provider.generate({
    instructions: "x",
    input: [{ type: "user", text: "hola" }],
    tools: [],
    maxOutputTokens: 100,
    signal,
  });

  await assert.rejects(
    provider.generate({
      instructions: "x",
      input: [{ type: "tool_result", callId: "c1", output: {} }],
      tools: [],
      maxOutputTokens: 100,
      continuation: { local: true },
      signal,
    }),
    (error) => error?.code === "AI_PROVIDER_UNAVAILABLE",
  );
  assert.equal(cloudCalls, 0);
});
