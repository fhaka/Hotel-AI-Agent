import { z } from "zod";

/** Usage limits as edited in the operator area (empty field = no override / unlimited). */
export const LIMIT_KEYS = ["ai_messages_per_month", "ai_tokens_per_month", "voice_minutes_per_month", "agents", "members"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const LIMIT_LABELS: Record<LimitKey, string> = {
  ai_messages_per_month: "AI messages / period",
  ai_tokens_per_month: "AI tokens / period",
  voice_minutes_per_month: "Voice minutes / period",
  agents: "Agents",
  members: "Team members",
};

const limitValue = z
  .string()
  .trim()
  .regex(/^\d{0,10}$/, "Whole number or empty")
  .transform((v) => (v === "" ? undefined : Number(v)))
  .refine((v) => v === undefined || v <= 1_000_000_000, "Too large");

/** Reads `limit.<key>` fields; returns only the keys that have a value. */
export function parseLimits(formData: FormData): { ok: true; limits: Partial<Record<LimitKey, number>> } | { ok: false; errors: Record<string, string> } {
  const limits: Partial<Record<LimitKey, number>> = {};
  const errors: Record<string, string> = {};
  for (const key of LIMIT_KEYS) {
    const parsed = limitValue.safeParse(String(formData.get(`limit.${key}`) ?? ""));
    if (!parsed.success) errors[`limit.${key}`] = parsed.error.issues[0].message;
    else if (parsed.data !== undefined) limits[key] = parsed.data;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, limits };
}

export const AGENT_TYPES = ["website_receptionist", "reservation_assistant", "voice_receptionist"] as const;
/** Feature flags a plan can carry. Agent types and "automations" are enforced; the rest describe the plan. */
export const FEATURES = [
  ...AGENT_TYPES,
  "knowledge_base",
  "automations",
  "calendar",
  "basic_reports",
  "advanced_reports",
  "integrations",
  "email_support",
  "priority_support",
] as const;

export const suspensionSchema = z.object({
  suspended: z.enum(["true", "false"]).transform((v) => v === "true"),
  reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional(),
}).refine((v) => !v.suspended || (v.reason?.length ?? 0) >= 3, { message: "Give a reason (shown to the operator team only)", path: ["reason"] });

export const planSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean(),
  features: z.array(z.enum(FEATURES)),
});

const days = (min: number, max: number) => z.coerce.number({ error: "Enter a number" }).int("Whole days").min(min, `At least ${min}`).max(max, `At most ${max}`);

export const trialSettingsSchema = z.object({
  days: days(1, 60),
  max_trials_per_user: z.coerce.number().int().min(0).max(10),
  plan_id: z.string().regex(/^[a-z0-9_]{2,40}$/),
});

export const retentionSchema = z.object({
  playground_retention_days: days(1, 3650),
  conversation_retention_days: days(1, 3650),
  notification_days: days(7, 3650),
  job_run_days: days(7, 3650),
  webhook_payload_days: days(7, 3650),
  audit_log_days: days(7, 3650),
});

export const E164 = /^\+[1-9][0-9]{6,14}$/;
