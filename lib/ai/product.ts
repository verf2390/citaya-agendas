export const AI_PRODUCT_IDS = [
  "agendas",
  "retail",
  "n8n",
  "web_creators",
] as const;

export type AIProductId = (typeof AI_PRODUCT_IDS)[number];

export function isAIProductId(value: unknown): value is AIProductId {
  return (
    typeof value === "string" &&
    (AI_PRODUCT_IDS as readonly string[]).includes(value)
  );
}
