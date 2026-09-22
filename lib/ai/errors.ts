export type AIErrorCode =
  | "AI_DISABLED"
  | "AI_INVALID_REQUEST"
  | "AI_PROVIDER_CONFIG"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_INVALID_RESPONSE"
  | "AI_DAILY_TOKEN_LIMIT"
  | "AI_AUDIT_UNAVAILABLE"
  | "AI_TOOL_NOT_ALLOWED"
  | "AI_TOOL_INVALID_ARGUMENTS"
  | "AI_TOOL_FAILED"
  | "AI_MAX_STEPS"
  | "AI_TIMEOUT";

export class AIError extends Error {
  readonly code: AIErrorCode;

  constructor(code: AIErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AIError";
    this.code = code;
  }
}

export function safeAIErrorCode(error: unknown): AIErrorCode {
  if (error instanceof AIError) return error.code;
  if (error instanceof DOMException && error.name === "AbortError") {
    return "AI_TIMEOUT";
  }
  return "AI_PROVIDER_UNAVAILABLE";
}
