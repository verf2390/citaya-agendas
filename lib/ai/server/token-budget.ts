const ESTIMATED_INPUT_TOKENS = 4_000;
const AUDIT_RESERVATION_MAX = 8_192;

export function reservedTokensForAIRequest(input: {
  dailyTokenLimit: number;
  maxOutputTokens: number;
}) {
  return Math.min(
    input.dailyTokenLimit,
    input.maxOutputTokens + ESTIMATED_INPUT_TOKENS,
    AUDIT_RESERVATION_MAX,
  );
}
