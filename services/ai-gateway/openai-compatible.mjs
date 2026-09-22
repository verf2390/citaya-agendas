const MAX_MESSAGES = 32;
const MAX_TOOLS = 12;
const MAX_TEXT = 20_000;

function invalid(message) {
  const error = new Error(message);
  error.code = "AI_GATEWAY_INVALID_REQUEST";
  return error;
}

function nonEmptyString(value, name, max = MAX_TEXT) {
  if (typeof value !== "string") throw invalid(`${name} inválido`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw invalid(`${name} inválido`);
  return trimmed;
}

function jsonString(value) {
  try {
    return JSON.stringify(value);
  } catch {
    throw invalid("Tool result no serializable");
  }
}

function validateContinuation(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("Continuation inválida");
  }
  const messages = value.messages;
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) {
    throw invalid("Continuation inválida");
  }
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw invalid("Continuation inválida");
    }
    if (!["system", "user", "assistant", "tool"].includes(message.role)) {
      throw invalid("Continuation inválida");
    }
  }
  return structuredClone(messages);
}

function normalizeToolDefinition(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    throw invalid("Tool inválida");
  }
  return {
    type: "function",
    function: {
      name: nonEmptyString(tool.name, "tool.name", 120),
      description:
        typeof tool.description === "string"
          ? tool.description.slice(0, 2_000)
          : "",
      parameters:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? tool.inputSchema
          : { type: "object", properties: {}, additionalProperties: false },
    },
  };
}

export function buildOpenAICompatibleRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("Payload inválido");
  }
  if (payload.contractVersion !== "citaya-ai-provider-v1") {
    throw invalid("Versión de contrato no soportada");
  }

  const model = nonEmptyString(payload.model, "model", 120);
  const instructions = nonEmptyString(payload.instructions, "instructions");
  if (!Array.isArray(payload.input) || payload.input.length > MAX_MESSAGES) {
    throw invalid("Input inválido");
  }
  if (!Array.isArray(payload.tools) || payload.tools.length > MAX_TOOLS) {
    throw invalid("Tools inválidas");
  }

  const maxOutputTokens = Number(payload.maxOutputTokens);
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 4_096
  ) {
    throw invalid("maxOutputTokens inválido");
  }

  const previous = validateContinuation(payload.continuation);
  const messages = previous ?? [{ role: "system", content: instructions }];

  for (const item of payload.input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw invalid("Input inválido");
    }
    if (item.type === "user" || item.type === "assistant") {
      messages.push({
        role: item.type,
        content: nonEmptyString(item.text, "input.text"),
      });
      continue;
    }
    if (item.type === "tool_result") {
      messages.push({
        role: "tool",
        tool_call_id: nonEmptyString(item.callId, "callId", 200),
        content: jsonString(item.output),
      });
      continue;
    }
    throw invalid("Tipo de input no soportado");
  }

  if (messages.length > MAX_MESSAGES) {
    throw invalid("Demasiados mensajes para el gateway");
  }

  const tools = payload.tools.map(normalizeToolDefinition);
  const upstream = {
    model,
    messages,
    stream: false,
    max_tokens: maxOutputTokens,
  };
  if (tools.length > 0) {
    upstream.tools = tools;
    upstream.tool_choice = "auto";
    upstream.parallel_tool_calls = false;
  }
  return upstream;
}

function parseToolArguments(value) {
  if (typeof value !== "string") throw invalid("Argumentos de tool inválidos");
  try {
    return JSON.parse(value);
  } catch {
    throw invalid("Argumentos de tool no son JSON válido");
  }
}

function tokenCount(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function parseOpenAICompatibleResponse(payload, requestMessages) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("Respuesta upstream inválida");
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message =
    choice?.message && typeof choice.message === "object"
      ? choice.message
      : null;
  if (!message) throw invalid("Respuesta upstream sin mensaje");

  const text = typeof message.content === "string" ? message.content : "";
  const rawToolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
    : [];
  const toolCalls = rawToolCalls.map((call) => ({
    id: nonEmptyString(call?.id, "tool_call.id", 200),
    name: nonEmptyString(call?.function?.name, "tool_call.name", 120),
    arguments: parseToolArguments(call?.function?.arguments),
  }));

  if (!text.trim() && toolCalls.length === 0) {
    throw invalid("Respuesta upstream vacía");
  }

  const continuationMessage = {
    role: "assistant",
    content: text || null,
  };
  if (rawToolCalls.length > 0) {
    continuationMessage.tool_calls = rawToolCalls;
  }

  const inputTokens = tokenCount(payload.usage?.prompt_tokens);
  const outputTokens = tokenCount(payload.usage?.completion_tokens);
  const reportedTotal = tokenCount(payload.usage?.total_tokens);

  return {
    text,
    toolCalls,
    continuation: {
      messages: [...requestMessages, continuationMessage].slice(-MAX_MESSAGES),
    },
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: Math.max(reportedTotal, inputTokens + outputTokens),
    },
  };
}
