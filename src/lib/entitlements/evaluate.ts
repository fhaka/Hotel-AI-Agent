import { can, type Permission } from "./permissions";
import type { AgentType, EntitlementSnapshot } from "./snapshot";

/**
 * Pure decision logic over a database snapshot. Every denial carries a
 * stable code so API routes and UI show consistent errors.
 */
export type DenialCode =
  | "not_member"
  | "role_not_allowed"
  | "subscription_inactive"
  | "trial_expired"
  | "feature_not_in_plan"
  | "usage_limit_reached"
  | "agent_disabled"
  | "agent_unavailable";

export type Decision = { allowed: true } | { allowed: false; code: DenialCode; message: string };

const ALLOW: Decision = { allowed: true };

function deny(code: DenialCode, message: string): Decision {
  return { allowed: false, code, message };
}

const INACTIVE_MESSAGES: Record<string, string> = {
  trial_expired: "Your free trial has ended. Choose a plan to continue using AI agents.",
  no_active_plan: "This workspace has no active plan. Choose a plan to use AI agents.",
  subscription_canceled: "Your subscription has ended. Choose a plan to continue.",
  subscription_expired: "Your subscription has expired. Choose a plan to continue.",
  subscription_paused: "Your subscription is paused.",
  no_subscription: "This workspace has no subscription.",
};

export function subscriptionDecision(s: EntitlementSnapshot): Decision {
  if (s.access_active) return ALLOW;
  const reason = s.reason ?? "no_active_plan";
  return deny(reason === "trial_expired" ? "trial_expired" : "subscription_inactive", INACTIVE_MESSAGES[reason] ?? INACTIVE_MESSAGES.no_active_plan);
}

export type UsageMeter = { used: number; limit: number | null; ratio: number | null };

function meter(used: number, limit: number | undefined): UsageMeter {
  if (limit === undefined) return { used, limit: null, ratio: null };
  return { used, limit, ratio: limit === 0 ? 1 : Math.min(used / limit, 1) };
}

export function usageMeters(s: EntitlementSnapshot) {
  return {
    aiMessages: meter(s.usage.ai_messages, s.limits.ai_messages_per_month),
    aiTokens: meter(s.usage.ai_tokens, s.limits.ai_tokens_per_month),
    voiceMinutes: meter(s.usage.voice_minutes, s.limits.voice_minutes_per_month),
    members: meter(s.usage.members + s.usage.pending_invitations, s.limits.members),
  };
}

function exhausted(m: UsageMeter): boolean {
  return m.limit !== null && m.used >= m.limit;
}

export function hasFeature(s: EntitlementSnapshot, feature: string): boolean {
  return s.features.includes(feature);
}

export function permissionDecision(s: EntitlementSnapshot, permission: Permission): Decision {
  if (!s.role) return deny("not_member", "You are not a member of this workspace.");
  return can(s.role, permission) ? ALLOW : deny("role_not_allowed", "Your role does not allow this action.");
}

/**
 * The full pre-flight check for running an AI agent (used by the agent
 * runtime in Phase 5). Order matters: the first failing rule is reported.
 *   1-2. authenticated member (snapshot only exists for members)
 *   3.   role may use agents
 *   4-5. subscription / trial active (database clock)
 *   6.   within usage limits
 *   7.   agent enabled, available, and included in the plan
 */
export function checkAgentExecution(
  s: EntitlementSnapshot,
  agentType: AgentType,
  opts: { requireRole?: boolean } = { requireRole: true },
): Decision {
  if (opts.requireRole !== false) {
    const role = permissionDecision(s, "agents.use");
    if (!role.allowed) return role;
  }
  const sub = subscriptionDecision(s);
  if (!sub.allowed) return sub;

  const m = usageMeters(s);
  if (exhausted(m.aiMessages) || exhausted(m.aiTokens)) {
    return deny("usage_limit_reached", "This workspace has reached its AI usage limit for the current period.");
  }

  const agent = s.agents.find((a) => a.agent_type === agentType);
  if (!agent || agent.status === "not_configured" || agent.status === "disabled") {
    return deny("agent_unavailable", "This agent is not available for this workspace.");
  }
  if (!agent.enabled) return deny("agent_disabled", "This agent is turned off. An owner or admin can enable it.");
  if (!hasFeature(s, agentType)) {
    return deny("feature_not_in_plan", "Your current plan does not include this agent.");
  }
  if (agentType === "voice_receptionist" && exhausted(m.voiceMinutes)) {
    return deny("usage_limit_reached", "This workspace has used all included voice minutes.");
  }
  return ALLOW;
}

export type Entitlements = ReturnType<typeof summarizeEntitlements>;

/** Capability flags for pages and server actions (the getBusinessEntitlements result). */
export function summarizeEntitlements(s: EntitlementSnapshot) {
  const sub = subscriptionDecision(s);
  const meters = usageMeters(s);
  const active = sub.allowed;
  return {
    snapshot: s,
    role: s.role,
    planId: s.plan_id ?? null,
    planName: s.plan_name ?? s.plan_id ?? null,
    subscriptionStatus: s.subscription_status ?? null,
    isTrial: s.is_trial ?? false,
    trialEndsAt: s.trial_ends_at ? new Date(s.trial_ends_at) : null,
    accessActive: active,
    inactiveReason: sub.allowed ? null : sub,
    usage: meters,
    canUseAgents: active && can(s.role, "agents.use") && !exhausted(meters.aiMessages) && !exhausted(meters.aiTokens),
    canCreateReservations: active && can(s.role, "reservations.manage"),
    canUseVoice: active && hasFeature(s, "voice_receptionist") && (meters.voiceMinutes.limit ?? 0) > 0 && !exhausted(meters.voiceMinutes),
    canUseAutomation: active && hasFeature(s, "automations"),
    canInviteMembers: active && can(s.role, "team.manage") && !exhausted(meters.members),
    can: (permission: Permission) => can(s.role, permission),
    agent: (agentType: AgentType) => checkAgentExecution(s, agentType),
  };
}

/** Warnings worth showing in the workspace banner. */
export function entitlementWarnings(s: EntitlementSnapshot, now: Date): { tone: "warning" | "danger"; code: string; message: string }[] {
  const out: { tone: "warning" | "danger"; code: string; message: string }[] = [];
  const sub = subscriptionDecision(s);
  if (!sub.allowed) {
    out.push({ tone: "danger", code: sub.code, message: sub.message });
    return out;
  }
  if (s.is_trial && s.trial_ends_at) {
    const hoursLeft = (new Date(s.trial_ends_at).getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft <= 48) {
      out.push({ tone: "warning", code: "trial_ending", message: hoursLeft <= 24 ? "Your free trial ends within 24 hours." : "Your free trial ends in less than 2 days." });
    }
  }
  if (s.reason === "payment_past_due") out.push({ tone: "warning", code: "payment_past_due", message: "Your last payment failed. Please update your payment method to avoid interruption." });
  if (s.reason === "cancels_at_period_end") out.push({ tone: "warning", code: "cancels_at_period_end", message: "Your subscription is canceled and ends at the close of the current billing period." });
  const m = usageMeters(s);
  if ((m.aiMessages.ratio ?? 0) >= 0.8 || (m.aiTokens.ratio ?? 0) >= 0.8) {
    out.push({ tone: "warning", code: "usage_high", message: "You have used over 80% of this period's AI allowance." });
  }
  return out;
}
