import { z } from "zod";

/**
 * Shape of public.get_business_entitlements(). Parsed strictly so a schema
 * change in the database fails loudly instead of silently granting access.
 */
const num = z.coerce.number();
const limit = z.coerce.number().int().nonnegative().optional();

export const entitlementSnapshotSchema = z.object({
  evaluated_at: z.string(),
  access_active: z.boolean(),
  reason: z.string().nullable().optional(),
  role: z.enum(["owner", "admin", "manager", "staff"]).optional(),
  subscription_status: z
    .enum(["trialing", "active", "past_due", "paused", "canceled", "expired", "incomplete"])
    .optional(),
  plan_id: z.string().optional(),
  plan_name: z.string().nullable().optional(),
  billing_interval: z.enum(["month", "year"]).nullable().optional(),
  is_trial: z.boolean().optional(),
  trial_started_at: z.string().nullable().optional(),
  trial_ends_at: z.string().nullable().optional(),
  current_period_end: z.string().nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  limits: z
    .object({
      ai_messages_per_month: limit,
      ai_tokens_per_month: limit,
      voice_minutes_per_month: limit,
      agents: limit,
      members: limit,
    })
    .default({}),
  features: z.array(z.string()).default([]),
  usage: z
    .object({
      ai_messages: num.default(0),
      ai_tokens: num.default(0),
      voice_minutes: num.default(0),
      members: num.default(0),
      pending_invitations: num.default(0),
    })
    .default({ ai_messages: 0, ai_tokens: 0, voice_minutes: 0, members: 0, pending_invitations: 0 }),
  agents: z
    .array(
      z.object({
        id: z.string(),
        agent_type: z.enum(["website_receptionist", "reservation_assistant", "voice_receptionist"]),
        enabled: z.boolean(),
        status: z.enum(["draft", "ready", "not_configured", "disabled"]),
        usage_limit: z.number().nullable().optional(),
      }),
    )
    .default([]),
});

export type EntitlementSnapshot = z.output<typeof entitlementSnapshotSchema>;
export type BusinessRole = NonNullable<EntitlementSnapshot["role"]>;
export type AgentType = EntitlementSnapshot["agents"][number]["agent_type"];
