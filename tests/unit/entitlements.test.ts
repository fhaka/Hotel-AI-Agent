import { describe, expect, it } from "vitest";
import { checkAgentExecution, entitlementWarnings, summarizeEntitlements, usageMeters } from "@/lib/entitlements/evaluate";
import { can, invitableRoles, manageableRoles } from "@/lib/entitlements/permissions";
import { entitlementSnapshotSchema, type EntitlementSnapshot } from "@/lib/entitlements/snapshot";

const now = new Date("2026-11-11T12:00:00Z");

function snapshot(overrides: Partial<Record<string, unknown>> = {}): EntitlementSnapshot {
  return entitlementSnapshotSchema.parse({
    evaluated_at: now.toISOString(),
    access_active: true,
    reason: null,
    role: "owner",
    subscription_status: "trialing",
    plan_id: "growth",
    plan_name: "Growth",
    is_trial: true,
    trial_ends_at: "2026-11-18T12:00:00Z",
    limits: { ai_messages_per_month: 300, ai_tokens_per_month: 600000, voice_minutes_per_month: 0, agents: 2, members: 3 },
    features: ["website_receptionist", "reservation_assistant", "automations"],
    usage: { ai_messages: "10", ai_tokens: "5000", voice_minutes: 0, members: 1, pending_invitations: 0 },
    agents: [
      { id: "a1", agent_type: "website_receptionist", enabled: true, status: "draft" },
      { id: "a2", agent_type: "reservation_assistant", enabled: false, status: "draft" },
      { id: "a3", agent_type: "voice_receptionist", enabled: false, status: "not_configured" },
    ],
    ...overrides,
  });
}

describe("snapshot parsing", () => {
  it("coerces numeric strings from Postgres numeric columns", () => {
    expect(snapshot().usage.ai_messages).toBe(10);
  });
  it("fails closed on unexpected shapes", () => {
    expect(entitlementSnapshotSchema.safeParse({ access_active: "yes" }).success).toBe(false);
    expect(entitlementSnapshotSchema.safeParse({ evaluated_at: "x", access_active: true, role: "superuser" }).success).toBe(false);
  });
});

describe("checkAgentExecution", () => {
  it("allows an enabled agent in an active trial", () => {
    expect(checkAgentExecution(snapshot(), "website_receptionist")).toEqual({ allowed: true });
  });

  it("denies after the trial expired", () => {
    const d = checkAgentExecution(snapshot({ access_active: false, reason: "trial_expired" }), "website_receptionist");
    expect(d).toMatchObject({ allowed: false, code: "trial_expired" });
  });

  it("denies when there is no active plan", () => {
    const d = checkAgentExecution(snapshot({ access_active: false, reason: "no_active_plan", subscription_status: "incomplete" }), "website_receptionist");
    expect(d).toMatchObject({ allowed: false, code: "subscription_inactive" });
  });

  it("denies when the message or token allowance is used up", () => {
    expect(
      checkAgentExecution(snapshot({ usage: { ai_messages: 300, ai_tokens: 0, voice_minutes: 0, members: 1, pending_invitations: 0 } }), "website_receptionist"),
    ).toMatchObject({ code: "usage_limit_reached" });
    expect(
      checkAgentExecution(snapshot({ usage: { ai_messages: 1, ai_tokens: 600000, voice_minutes: 0, members: 1, pending_invitations: 0 } }), "website_receptionist"),
    ).toMatchObject({ code: "usage_limit_reached" });
  });

  it("denies disabled, unavailable and not-in-plan agents", () => {
    expect(checkAgentExecution(snapshot(), "reservation_assistant")).toMatchObject({ code: "agent_disabled" });
    expect(checkAgentExecution(snapshot(), "voice_receptionist")).toMatchObject({ code: "agent_unavailable" });
    const basic = snapshot({
      features: ["website_receptionist"],
      agents: [{ id: "a2", agent_type: "reservation_assistant", enabled: true, status: "draft" }],
    });
    expect(checkAgentExecution(basic, "reservation_assistant")).toMatchObject({ code: "feature_not_in_plan" });
  });

  it("checks membership/role before anything else", () => {
    expect(checkAgentExecution(snapshot({ role: undefined, access_active: false }), "website_receptionist")).toMatchObject({ code: "not_member" });
  });

  it("subscription problems are reported before usage problems", () => {
    const s = snapshot({ access_active: false, reason: "trial_expired", usage: { ai_messages: 999, ai_tokens: 0, voice_minutes: 0, members: 1, pending_invitations: 0 } });
    expect(checkAgentExecution(s, "website_receptionist")).toMatchObject({ code: "trial_expired" });
  });

  it("public channels can skip the role check but nothing else", () => {
    const s = snapshot({ role: undefined });
    expect(checkAgentExecution(s, "website_receptionist", { requireRole: false })).toEqual({ allowed: true });
    expect(checkAgentExecution({ ...s, access_active: false, reason: "trial_expired" }, "website_receptionist", { requireRole: false })).toMatchObject({ allowed: false });
  });
});

describe("summarizeEntitlements", () => {
  it("derives capability flags", () => {
    const e = summarizeEntitlements(snapshot());
    expect(e).toMatchObject({ accessActive: true, canUseAgents: true, canUseAutomation: true, canUseVoice: false, canInviteMembers: true, isTrial: true });
    expect(e.can("billing.manage")).toBe(true);
  });

  it("staff can use agents but not manage the team or billing", () => {
    const e = summarizeEntitlements(snapshot({ role: "staff" }));
    expect(e.canUseAgents).toBe(true);
    expect(e.canInviteMembers).toBe(false);
    expect(e.can("billing.view")).toBe(false);
  });

  it("expired trial blocks agents, reservations and invites but keeps viewing", () => {
    const e = summarizeEntitlements(snapshot({ access_active: false, reason: "trial_expired" }));
    expect(e).toMatchObject({ canUseAgents: false, canCreateReservations: false, canInviteMembers: false });
    expect(e.can("workspace.view")).toBe(true);
  });

  it("seat limit counts pending invitations", () => {
    const e = summarizeEntitlements(snapshot({ usage: { ai_messages: 0, ai_tokens: 0, voice_minutes: 0, members: 2, pending_invitations: 1 } }));
    expect(e.canInviteMembers).toBe(false);
    expect(e.usage.members).toEqual({ used: 3, limit: 3, ratio: 1 });
  });

  it("voice requires the feature and minutes", () => {
    const e = summarizeEntitlements(
      snapshot({ features: ["voice_receptionist"], limits: { voice_minutes_per_month: 300 }, usage: { ai_messages: 0, ai_tokens: 0, voice_minutes: 10, members: 1, pending_invitations: 0 } }),
    );
    expect(e.canUseVoice).toBe(true);
  });
});

describe("usage meters and warnings", () => {
  it("handles missing limits as unlimited", () => {
    expect(usageMeters(snapshot({ limits: {} })).aiMessages).toEqual({ used: 10, limit: null, ratio: null });
  });

  it("warns when the trial is about to end and when usage is high", () => {
    const s = snapshot({ trial_ends_at: "2026-11-12T06:00:00Z", usage: { ai_messages: 250, ai_tokens: 0, voice_minutes: 0, members: 1, pending_invitations: 0 } });
    expect(entitlementWarnings(s, now).map((w) => w.code)).toEqual(["trial_ending", "usage_high"]);
  });

  it("shows a single danger message when access is inactive", () => {
    expect(entitlementWarnings(snapshot({ access_active: false, reason: "trial_expired" }), now)).toEqual([
      expect.objectContaining({ tone: "danger", code: "trial_expired" }),
    ]);
  });
});

describe("role permissions", () => {
  it("matches the database role hierarchy", () => {
    expect(manageableRoles("owner")).toEqual(["owner", "admin", "manager", "staff"]);
    expect(manageableRoles("admin")).toEqual(["manager", "staff"]);
    expect(manageableRoles("manager")).toEqual([]);
    expect(invitableRoles("owner")).toEqual(["admin", "manager", "staff"]);
    expect(can("manager", "knowledge.edit")).toBe(true);
    expect(can("staff", "knowledge.edit")).toBe(false);
    expect(can(undefined, "workspace.view")).toBe(false);
  });
});
