export type AIEffectiveProviderId = "openai" | "local";
export type AIProviderId = AIEffectiveProviderId | "hybrid";

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AIToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AIToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type AIProviderInput =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool_result"; callId: string; output: unknown };

export type AIConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

export type AIProviderRequest = {
  instructions: string;
  input: AIProviderInput[];
  tools: AIToolDefinition[];
  maxOutputTokens: number;
  continuation?: unknown;
  signal: AbortSignal;
};

export type AIRouteTurn = {
  effectiveProvider: AIEffectiveProviderId;
  effectiveModel: string;
  fallbackUsed: boolean;
};

export type AIRouteSummary = AIRouteTurn & {
  requestedProvider: AIProviderId;
  requestedModel: string;
  providerDurationMs: number;
};

export type AIProviderTurn = {
  text: string;
  toolCalls: AIToolCall[];
  continuation?: unknown;
  usage: AIUsage;
  route?: AIRouteTurn;
};

export interface AIProvider {
  readonly id: AIProviderId;
  readonly model: string;
  generate(request: AIProviderRequest): Promise<AIProviderTurn>;
}

export type AIToolContext = {
  tenantId: string;
  userId: string;
  tenantSlug: string;
  timezone: string;
  now: Date;
  signal?: AbortSignal;
};

export type AITool = {
  definition: AIToolDefinition;
  execute(argumentsValue: unknown, context: AIToolContext): Promise<unknown>;
};

export type AICoreResult = {
  text: string;
  toolsUsed: string[];
  usage: AIUsage;
  steps: number;
  route: AIRouteSummary;
};
