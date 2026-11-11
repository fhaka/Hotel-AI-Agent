import { z } from "zod";

/**
 * Business-editable agent behaviour, stored in agents.system_configuration.
 * These values are inserted into the prompt as clearly delimited business
 * preferences by the runtime (Phase 5); they can never replace the
 * platform's safety rules, which live in code.
 */
export const TONES = [
  { value: "friendly", label: "Friendly and warm" },
  { value: "professional", label: "Professional" },
  { value: "concise", label: "Short and to the point" },
] as const;

export const agentConfigSchema = z.object({
  greeting: z.string().trim().max(300, "Keep the greeting under 300 characters").default(""),
  tone: z.enum(["friendly", "professional", "concise"]).default("friendly"),
  escalation_message: z.string().trim().max(500, "Keep this under 500 characters").default(""),
  extra_instructions: z.string().trim().max(2000, "Keep instructions under 2000 characters").default(""),
});

export type AgentConfig = z.output<typeof agentConfigSchema>;

export const agentFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120, "Name is too long"),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? null : v)),
  enabled: z.boolean(),
  config: agentConfigSchema,
});

export function agentFormFromFormData(fd: FormData) {
  const s = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  return {
    name: s("name"),
    description: s("description"),
    enabled: fd.get("enabled") === "on",
    config: {
      greeting: s("greeting"),
      tone: s("tone") || undefined,
      escalation_message: s("escalationMessage"),
      extra_instructions: s("extraInstructions"),
    },
  };
}

/** Reads stored configuration defensively (unknown keys dropped, bad values defaulted). */
export function readAgentConfig(value: unknown): AgentConfig {
  const parsed = agentConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : agentConfigSchema.parse({});
}

export const AGENT_TYPE_INFO: Record<string, { summary: string }> = {
  website_receptionist: { summary: "Answers website visitors from your business information and hands complex requests to your team." },
  reservation_assistant: { summary: "Checks real availability, quotes prices and creates bookings only after the guest confirms." },
  voice_receptionist: { summary: "Answers phone calls. Requires a voice provider integration, which is not available yet." },
};

export const AGENT_STATUS_LABEL: Record<string, string> = {
  draft: "Configured, not yet tested",
  ready: "Ready",
  not_configured: "Not available yet",
  disabled: "Not used for this industry",
};
