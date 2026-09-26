export type DirectReadIntent =
  | {
      toolName: "get_pending_receivables";
      argumentsValue: { limit: number };
    }
  | {
      toolName: "count_appointments";
      argumentsValue: { date: string };
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
  return /\b(redact|mensaje|recordator|borrador|escrib|prepara|campan|analiz|explic|suger|recomiend|resum|compara|estrateg)\w*/.test(
    normalizePrompt(message),
  );
}

export function isPureDraftingRequest(message: string) {
  const prompt = normalizePrompt(message);
  const wantsDraft =
    /\b(redact|mensaje|recordator|borrador|escrib|prepara)\w*/.test(prompt);
  if (!wantsDraft) return false;

  const asksForBusinessData =
    /\b(mis|nuestros?|estos?|estas?|esos?|esas?|ellos|ellas|mism|anterior|previo|ultimo|datos?|lista|nombres?|segun|basad)\w*/.test(
      prompt,
    );

  return !asksForBusinessData;
}

function localDateKey(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function nextDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

export function resolveDirectReadIntent(
  message: string,
  context?: { now: Date; timezone: string },
): DirectReadIntent {
  const prompt = normalizePrompt(message);

  if (wantsGenerativeResponse(message)) return null;

  const mentionsAppointments =
    prompt.includes("reserva") || prompt.includes("cita");
  const asksToday = /\bhoy\b/.test(prompt);
  const asksTomorrow = /\bmanana\b/.test(prompt);

  if (mentionsAppointments && (asksToday || asksTomorrow) && context) {
    const today = localDateKey(context.now, context.timezone);
    return {
      toolName: "count_appointments",
      argumentsValue: {
        date: asksTomorrow ? nextDateKey(today) : today,
      },
    };
  }

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
