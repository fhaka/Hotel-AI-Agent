/**
 * Provider-neutral types for the agent runtime. The OpenAI adapter
 * (openai-model.ts) implements ModelClient; tests use a scripted fake.
 */
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema (strict-mode compatible) generated from the tool's Zod schema. */
  parameters: Record<string, unknown>;
};

export type FunctionCall = { callId: string; name: string; arguments: string };

/** Items appended during a turn's tool loop, in order. */
export type ContinuationItem =
  | { kind: "model_output"; items: unknown[] } // provider-native output items, passed back verbatim
  | { kind: "tool_result"; callId: string; output: string };

export type ModelRequest = {
  instructions: string;
  messages: ChatMessage[];
  continuation: ContinuationItem[];
  tools: ToolSpec[];
  /** Stable, non-reversible per-user identifier for provider abuse detection. */
  safetyIdentifier: string;
  signal?: AbortSignal;
};

export type ModelResponse = {
  text: string;
  functionCalls: FunctionCall[];
  outputItems: unknown[];
  usage: { inputTokens: number; outputTokens: number };
  incompleteReason: string | null;
  model: string;
};

export interface ModelClient {
  respond(request: ModelRequest): Promise<ModelResponse>;
}
