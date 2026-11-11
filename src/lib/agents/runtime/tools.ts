import { z } from "zod";
import type { AgentType } from "@/lib/entitlements/snapshot";
import { reservationTools, type ReservationServices } from "./reservation-tools";
import type { ToolSpec } from "./types";

/**
 * Tool registry. Tools NEVER take a business id (or any tenant identifier)
 * as an argument: the business comes from ToolContext, which the runtime
 * builds from server-side state. Arguments are validated with the same Zod
 * schema that generates the strict JSON schema sent to the model.
 */
export type ToolResult = {
  ok: boolean;
  /** JSON-serializable data returned to the model. */
  data: unknown;
  /** Short, non-sensitive description stored in the transcript. */
  summary: string;
  escalated?: boolean;
  /** Confirmation references this result proves exist (reply guard allow-list). */
  references?: string[];
};

export type ToolContext = {
  businessId: string;
  conversationId: string;
  agentId: string;
  /** Business-configured hand-over message, if any. */
  escalationMessage: string | null;
  services: {
    searchKnowledge(query: string): Promise<{ title: string; content: string; category: string }[]>;
    escalate(details: Record<string, unknown>): Promise<boolean>;
    /** Present for agents with booking tools. */
    reservations?: ReservationServices;
  };
};

type AnyTool = {
  name: string;
  description: string;
  schema: z.ZodType;
  agentTypes: readonly AgentType[];
  execute(ctx: ToolContext, args: unknown): Promise<ToolResult>;
};

function defineTool<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  schema: S;
  agentTypes: readonly AgentType[];
  execute(ctx: ToolContext, args: z.output<S>): Promise<ToolResult>;
}): AnyTool {
  return tool as AnyTool;
}

const nullableText = (max: number) => z.string().max(max).nullable();

export const searchKnowledgeTool = defineTool({
  name: "search_knowledge",
  description:
    "Search the business's knowledge base for information not shown in <business_knowledge> (for example when it was too long to include). Returns up to 5 matching entries.",
  schema: z.strictObject({
    query: z.string().min(2).max(200).describe("A short search phrase, e.g. 'parking' or 'late check-out'."),
  }),
  agentTypes: ["website_receptionist", "reservation_assistant", "voice_receptionist"],
  async execute(ctx, args) {
    const results = await ctx.services.searchKnowledge(args.query);
    return {
      ok: true,
      data: { results },
      summary: `Searched knowledge for "${args.query.slice(0, 60)}": ${results.length} result(s)`,
    };
  },
});

export const humanHandoffTool = defineTool({
  name: "request_human_handoff",
  description:
    "Hand the conversation to the business's staff when you cannot answer from the available information, when the customer asks for a person, or for requests you are not allowed to complete. Include contact details only if the customer provided them.",
  schema: z.strictObject({
    reason: z.string().min(3).max(500).describe("Why staff need to take over, in one or two sentences."),
    customer_name: nullableText(200).describe("Customer's name if they gave it, otherwise null."),
    customer_email: z.email().max(320).nullable().describe("Customer's email if they gave it, otherwise null."),
    customer_phone: z
      .string()
      .regex(/^\+?[0-9 ()./-]{5,40}$/)
      .nullable()
      .describe("Customer's phone number if they gave it, otherwise null."),
  }),
  agentTypes: ["website_receptionist", "reservation_assistant", "voice_receptionist"],
  async execute(ctx, args) {
    const ok = await ctx.services.escalate({
      reason: args.reason,
      customer_name: args.customer_name,
      customer_email: args.customer_email,
      customer_phone: args.customer_phone,
      requested_at: new Date().toISOString(),
    });
    return {
      ok,
      escalated: ok,
      data: ok
        ? {
            handed_off: true,
            tell_customer:
              ctx.escalationMessage ||
              "A member of staff will follow up. Tell the customer this without promising a specific response time.",
          }
        : { handed_off: false, error: "handoff_failed" },
      // Contact details are NOT copied into the transcript summary.
      summary: ok ? `Handed over to staff: ${args.reason.slice(0, 120)}` : "Hand-over failed",
    };
  },
});

export const ALL_TOOLS: AnyTool[] = [searchKnowledgeTool, humanHandoffTool, ...(reservationTools as unknown as AnyTool[])];

export function toolsFor(agentType: AgentType): AnyTool[] {
  return ALL_TOOLS.filter((t) => t.agentTypes.includes(agentType));
}

/**
 * JSON schema sent to the model: structural keywords only (types, properties,
 * enums, descriptions). Value constraints (lengths, patterns, formats) are
 * enforced server-side by the Zod schema before any tool runs, so the model
 * schema stays within what strict function calling is sure to accept.
 */
const STRUCTURAL_KEYS = new Set(["type", "properties", "required", "additionalProperties", "items", "anyOf", "enum", "description", "const"]);

export function toModelSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toModelSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!STRUCTURAL_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toModelSchema(v)]));
    } else {
      out[key] = toModelSchema(value);
    }
  }
  return out;
}

export function toolSpec(tool: AnyTool): ToolSpec {
  const schema = toModelSchema(z.toJSONSchema(tool.schema)) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, parameters: schema };
}

export type { AnyTool as AgentTool };
