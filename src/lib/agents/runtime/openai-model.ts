import "server-only";
import OpenAI from "openai";
import { AgentError } from "./errors";
import type { ModelClient, ModelRequest, ModelResponse } from "./types";

/**
 * OpenAI Responses API adapter (official SDK; request/response shapes
 * verified against the SDK's type definitions).
 *
 * - store: false — conversations are kept in our database, not at OpenAI.
 * - Reasoning items are passed back within a turn's tool loop. With
 *   store: false that requires `include: ["reasoning.encrypted_content"]`
 *   (configurable via OPENAI_INCLUDE_REASONING for models that reject it).
 * - Strict function tools; one tool call at a time for predictable flows.
 */
export function createOpenAIModel(): ModelClient {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) throw new AgentError("not_configured");
  const includeReasoning = process.env.OPENAI_INCLUDE_REASONING !== "false";
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 1500;
  const client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 2 });

  return {
    async respond(req: ModelRequest): Promise<ModelResponse> {
      const input: OpenAI.Responses.ResponseInput = [
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ...req.continuation.flatMap((c): OpenAI.Responses.ResponseInputItem[] =>
          c.kind === "model_output"
            ? (c.items as OpenAI.Responses.ResponseInputItem[])
            : [{ type: "function_call_output", call_id: c.callId, output: c.output }],
        ),
      ];
      try {
        const response = await client.responses.create(
          {
            model,
            instructions: req.instructions,
            input,
            tools: req.tools.map((t) => ({
              type: "function" as const,
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              strict: true,
            })),
            parallel_tool_calls: false,
            store: false,
            include: includeReasoning ? ["reasoning.encrypted_content"] : undefined,
            max_output_tokens: maxOutputTokens,
            safety_identifier: req.safetyIdentifier,
          },
          { signal: req.signal },
        );
        const functionCalls = response.output.flatMap((item) =>
          item.type === "function_call" ? [{ callId: item.call_id, name: item.name, arguments: item.arguments }] : [],
        );
        return {
          text: response.output_text ?? "",
          functionCalls,
          outputItems: response.output,
          usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
          incompleteReason: response.status === "incomplete" ? (response.incomplete_details?.reason ?? "unknown") : null,
          model: response.model ?? model,
        };
      } catch (err) {
        throw mapOpenAIError(err);
      }
    },
  };
}

export function mapOpenAIError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AgentError("model_timeout");
  if (err instanceof Error && err.name === "AbortError") return new AgentError("model_timeout");
  if (err instanceof OpenAI.RateLimitError) return new AgentError("model_rate_limited");
  if (err instanceof OpenAI.APIError) {
    // Log status/type only — never request content.
    console.error("[agent] OpenAI error", { status: err.status, type: (err as { type?: string }).type });
    if (err.status === 401 || err.status === 403) return new AgentError("not_configured", "The OpenAI API key was rejected. Check OPENAI_API_KEY.");
    if (err.status === 404) return new AgentError("not_configured", "The configured OpenAI model is not available to this account. Check OPENAI_MODEL.");
  } else {
    console.error("[agent] model call failed", { name: err instanceof Error ? err.name : "unknown" });
  }
  return new AgentError("model_error");
}
