export type DirectReadIntent =
  | {
      toolName: "get_pending_receivables";
      argumentsValue: { limit: number };
    }
  | null;

function normalizePrompt(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function wantsGenerativeResponse(message: string) {
  return /\b(redact|mensaje|campan|analiz|explic|suger|recomiend|resum|compara|estrateg)\w*/.test(
    normalizePrompt(message),
  );
}

export function resolveDirectReadIntent(message: string): DirectReadIntent {
  const prompt = normalizePrompt(message);

  if (wantsGenerativeResponse(message)) return null;

  const mentionsPending = prompt.includes("pendiente");
  const mentionsReceivable =
    prompt.includes("cobrar") ||
    prompt.includes("cobro") ||
    prompt.includes("saldo") ||
    prompt.includes("pago");

  if (mentionsPending && mentionsReceivable) {
    return {
      toolName: "get_pending_receivables",
      argumentsValue: { limit: 50 },
    };
  }

  return null;
}
