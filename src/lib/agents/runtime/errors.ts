import type { DenialCode } from "@/lib/entitlements/evaluate";

export type AgentErrorCode =
  | DenialCode
  | "not_configured"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "conversation_not_found"
  | "model_timeout"
  | "model_rate_limited"
  | "model_error"
  | "internal_error";

const HTTP: Record<AgentErrorCode, number> = {
  not_member: 403,
  role_not_allowed: 403,
  subscription_inactive: 402,
  trial_expired: 402,
  feature_not_in_plan: 402,
  usage_limit_reached: 429,
  agent_disabled: 409,
  agent_unavailable: 409,
  not_configured: 503,
  not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  conversation_not_found: 404,
  model_timeout: 504,
  model_rate_limited: 503,
  model_error: 502,
  internal_error: 500,
};

const MESSAGES: Partial<Record<AgentErrorCode, string>> = {
  not_configured: "AI is not configured on this server yet (OpenAI API key, model or Supabase secret key missing).",
  not_found: "Agent not found.",
  invalid_request: "The request was not valid.",
  rate_limited: "You're sending messages too quickly. Please wait a moment.",
  conversation_not_found: "This conversation can't be continued. Start a new one.",
  model_timeout: "The AI took too long to answer. Please try again.",
  model_rate_limited: "The AI service is busy right now. Please try again shortly.",
  model_error: "The AI service returned an error. Please try again.",
  internal_error: "Something went wrong. Please try again.",
  trial_expired: "Your free trial has ended. Choose a plan to continue using AI agents.",
  subscription_inactive: "This workspace has no active plan.",
  usage_limit_reached: "This workspace has reached its AI usage limit for the current period.",
  agent_disabled: "This agent is turned off.",
  agent_unavailable: "This agent is not available for this workspace.",
  feature_not_in_plan: "Your current plan does not include this agent.",
};

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message?: string,
  ) {
    super(message ?? MESSAGES[code] ?? code);
    this.name = "AgentError";
  }
  get status(): number {
    return HTTP[this.code];
  }
}

/** Maps begin_agent_turn() denial reasons to error codes. */
export function fromTurnReason(reason: string | undefined): AgentError {
  switch (reason) {
    case "trial_expired":
      return new AgentError("trial_expired");
    case "usage_limit_reached":
      return new AgentError("usage_limit_reached");
    case "agent_disabled":
      return new AgentError("agent_disabled");
    case "agent_unavailable":
      return new AgentError("agent_unavailable");
    case "feature_not_in_plan":
      return new AgentError("feature_not_in_plan");
    case "conversation_not_found":
      return new AgentError("conversation_not_found");
    case "invalid_message":
      return new AgentError("invalid_request", "Messages must be between 1 and 2,000 characters.");
    default:
      return new AgentError("subscription_inactive");
  }
}
