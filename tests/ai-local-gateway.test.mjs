import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  buildOpenAICompatibleRequest,
  parseOpenAICompatibleResponse,
} from "../services/ai-gateway/openai-compatible.mjs";
import {
  bindDownstreamAbort,
  canWriteResponse,
} from "../services/ai-gateway/request-lifecycle.mjs";

test("gateway convierte el contrato Citaya a chat completions sin tenant hints", () => {
  const request = buildOpenAICompatibleRequest({
    contractVersion: "citaya-ai-provider-v1",
    model: "local-model",
    instructions: "Solo lectura",
    input: [{ type: "user", text: "¿Cuántas reservas tengo?" }],
    tools: [
      {
        name: "count_appointments",
        description: "Cuenta reservas",
        inputSchema: {
          type: "object",
          properties: { date: { type: "string" } },
          required: ["date"],
          additionalProperties: false,
        },
      },
    ],
    maxOutputTokens: 300,
    continuation: null,
  });

  assert.equal(request.model, "local-model");
  assert.deepEqual(request.messages, [
    { role: "system", content: "Solo lectura" },
    { role: "user", content: "¿Cuántas reservas tengo?" },
  ]);
  assert.equal(request.tools[0].function.name, "count_appointments");
  assert.equal(request.parallel_tool_calls, false);
  assert.equal("tenantId" in request, false);
  assert.equal("tenantSlug" in request, false);
});

test("gateway conserva tool call y continuation para el siguiente turno", () => {
  const request = buildOpenAICompatibleRequest({
    contractVersion: "citaya-ai-provider-v1",
    model: "local-model",
    instructions: "Solo lectura",
    input: [{ type: "user", text: "Reservas mañana" }],
    tools: [],
    maxOutputTokens: 300,
    continuation: null,
  });

  const result = parseOpenAICompatibleResponse(
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "count_appointments",
                  arguments: JSON.stringify({ date: "2026-09-23" }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    },
    request.messages,
  );

  assert.deepEqual(result.toolCalls, [
    {
      id: "call-1",
      name: "count_appointments",
      arguments: { date: "2026-09-23" },
    },
  ]);
  assert.equal(result.usage.totalTokens, 18);
  assert.equal(result.continuation.messages.at(-1).role, "assistant");
});

test("gateway agrega tool_result sobre la continuation sin recrear contexto", () => {
  const request = buildOpenAICompatibleRequest({
    contractVersion: "citaya-ai-provider-v1",
    model: "local-model",
    instructions: "ignorado al continuar",
    input: [
      {
        type: "tool_result",
        callId: "call-1",
        output: { active: 3, canceled: 1, total: 4 },
      },
    ],
    tools: [],
    maxOutputTokens: 300,
    continuation: {
      messages: [
        { role: "system", content: "Solo lectura" },
        { role: "user", content: "Reservas mañana" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "count_appointments",
                arguments: "{\"date\":\"2026-09-23\"}",
              },
            },
          ],
        },
      ],
    },
  });

  assert.equal(request.messages.at(-1).role, "tool");
  assert.equal(request.messages.at(-1).tool_call_id, "call-1");
  assert.match(request.messages.at(-1).content, /"active":3/);
});


test("gateway rechaza respuestas con exceso de tool calls", () => {
  const request = buildOpenAICompatibleRequest({
    contractVersion: "citaya-ai-provider-v1",
    model: "local-model",
    instructions: "Solo lectura",
    input: [{ type: "user", text: "hola" }],
    tools: [],
    maxOutputTokens: 100,
    continuation: null,
  });

  assert.throws(
    () =>
      parseOpenAICompatibleResponse(
        {
          choices: [
            {
              message: {
                content: "",
                tool_calls: Array.from({ length: 13 }, (_, index) => ({
                  id: `call-${index}`,
                  type: "function",
                  function: { name: "x", arguments: "{}" },
                })),
              },
            },
          ],
        },
        request.messages,
      ),
    /máximo de tools/,
  );
});


test("gateway aborta upstream si el cliente se desconecta antes de responder", () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  const controller = new AbortController();

  const lifecycle = bindDownstreamAbort(req, res, controller);
  res.emit("close");

  assert.equal(lifecycle.wasClientClosed(), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(canWriteResponse(res), true);
  lifecycle.cleanup();
});

test("gateway no marca cancelación cuando la respuesta ya terminó", () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writableEnded = true;
  res.destroyed = false;
  const controller = new AbortController();

  const lifecycle = bindDownstreamAbort(req, res, controller);
  res.emit("close");

  assert.equal(lifecycle.wasClientClosed(), false);
  assert.equal(controller.signal.aborted, false);
  assert.equal(canWriteResponse(res), false);
  lifecycle.cleanup();
});
