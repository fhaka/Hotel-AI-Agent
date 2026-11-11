import { leaksInstructions, referencesIn, unverifiedReferences } from "./prompt";
import { toolSpec, type AgentTool, type ToolContext } from "./tools";
import type { ChatMessage, ContinuationItem, ModelClient } from "./types";

export const MAX_TOOL_ROUNDS = 4;
export const MAX_REPLY_CHARS = 4000;
const MAX_TOOL_OUTPUT_CHARS = 8000;

export type ToolEvent = { name: string; summary: string; ok: boolean };

export type TurnResult = {
  reply: string;
  toolEvents: ToolEvent[];
  usage: { inputTokens: number; outputTokens: number };
  escalated: boolean;
  model: string;
  /** Set when the runtime replaced or adjusted the model's answer. */
  guard: "instruction_leak" | "unverified_reference" | "tool_rounds_exceeded" | "empty_reply" | "truncated" | null;
};

const UNVERIFIED_REFERENCE_REPLY =
  "I'm sorry, I couldn't verify the booking details just now, so I can't confirm a reservation yet. Would you like me to try again or pass your request to our team?";

const FALLBACK_REPLY =
  "I'm sorry, I can't help with that right now. Would you like me to pass your question to our team?";

/**
 * Runs one agent turn: model -> (validated tool calls -> model)* -> reply.
 * The model never executes anything itself; every tool call is validated
 * against the tool's Zod schema and executed server-side with a ToolContext
 * whose business id comes from the server.
 */
export async function runToolLoop(params: {
  model: ModelClient;
  instructions: string;
  messages: ChatMessage[];
  tools: AgentTool[];
  ctx: ToolContext;
  canary: string;
  safetyIdentifier: string;
  signal?: AbortSignal;
  /** Text of earlier messages in the conversation (references there are known). */
  priorText?: string[];
}): Promise<TurnResult> {
  const specs = params.tools.map(toolSpec);
  const continuation: ContinuationItem[] = [];
  const toolEvents: ToolEvent[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let escalated = false;
  let model = "";
  const knownReferences = new Set<string>([
    ...(params.priorText ?? []).flatMap(referencesIn),
    ...params.messages.flatMap((m) => referencesIn(m.content)),
  ]);

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await params.model.respond({
      instructions: params.instructions,
      messages: params.messages,
      continuation,
      tools: round < MAX_TOOL_ROUNDS ? specs : [], // last round: force a text answer
      safetyIdentifier: params.safetyIdentifier,
      signal: params.signal,
    });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;

    if (response.functionCalls.length === 0) {
      return finalize(response.text, { toolEvents, usage, escalated, model, canary: params.canary, knownReferences });
    }

    continuation.push({ kind: "model_output", items: response.outputItems });
    for (const call of response.functionCalls) {
      const tool = params.tools.find((t) => t.name === call.name);
      let output: unknown;
      if (!tool) {
        output = { error: "unknown_tool", message: `No tool named ${call.name} is available.` };
        toolEvents.push({ name: call.name.slice(0, 100), summary: "Unknown tool requested", ok: false });
      } else {
        let args: unknown;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          args = undefined;
        }
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
          output = {
            error: "invalid_arguments",
            issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
          };
          toolEvents.push({ name: tool.name, summary: "Rejected invalid arguments", ok: false });
        } else {
          try {
            const result = await tool.execute(params.ctx, parsed.data);
            output = result.data;
            escalated ||= Boolean(result.escalated);
            for (const ref of result.references ?? []) knownReferences.add(ref);
            toolEvents.push({ name: tool.name, summary: result.summary, ok: result.ok });
          } catch (err) {
            console.error("[agent] tool failed", { tool: tool.name, error: err instanceof Error ? err.name : "unknown" });
            output = { error: "tool_failed", message: "The tool failed. Do not guess; offer to hand over to staff." };
            toolEvents.push({ name: tool.name, summary: "Tool failed", ok: false });
          }
        }
      }
      continuation.push({ kind: "tool_result", callId: call.callId, output: JSON.stringify(output).slice(0, MAX_TOOL_OUTPUT_CHARS) });
    }
  }

  return { reply: FALLBACK_REPLY, toolEvents, usage, escalated, model, guard: "tool_rounds_exceeded" };
}

function finalize(
  text: string,
  state: {
    toolEvents: ToolEvent[];
    usage: TurnResult["usage"];
    escalated: boolean;
    model: string;
    canary: string;
    knownReferences: ReadonlySet<string>;
  },
): TurnResult {
  const base = { toolEvents: state.toolEvents, usage: state.usage, escalated: state.escalated, model: state.model };
  const trimmed = text.trim();
  if (!trimmed) return { ...base, reply: FALLBACK_REPLY, guard: "empty_reply" };
  if (leaksInstructions(trimmed, state.canary)) {
    console.warn("[agent] blocked a reply that leaked instructions");
    return { ...base, reply: FALLBACK_REPLY, guard: "instruction_leak" };
  }
  if (unverifiedReferences(trimmed, state.knownReferences).length > 0) {
    // The model mentioned a confirmation number no tool returned: never let
    // an invented booking reference reach a guest.
    console.warn("[agent] blocked a reply with an unverified confirmation reference");
    return { ...base, reply: UNVERIFIED_REFERENCE_REPLY, guard: "unverified_reference" };
  }
  if (trimmed.length > MAX_REPLY_CHARS) {
    return { ...base, reply: `${trimmed.slice(0, MAX_REPLY_CHARS - 1)}…`, guard: "truncated" };
  }
  return { ...base, reply: trimmed, guard: null };
}
