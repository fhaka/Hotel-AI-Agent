import { afterAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool, type Db } from "./helpers";

afterAll(async () => {
  await pool.end();
});

async function entitlements(userId: string, businessId: string) {
  return asUser(userId, async (db) => (await db.query("select public.get_business_entitlements($1) as e", [businessId])).rows[0].e);
}

/** Moves a business's trial window relative to now (operator override, like a support tool would). */
async function setTrialWindow(businessId: string, startOffset: string, endOffset: string) {
  await asService(async (db) => {
    await db.query("select set_config('hotelai.allow_trial_edit', 'on', true)");
    await db.query(
      `update public.subscriptions set trial_started_at = now() + $2::interval, trial_ends_at = now() + $3::interval
       where business_id = $1`,
      [businessId, startOffset, endOffset],
    );
  });
}

async function setSubscription(businessId: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  await asService((db) =>
    db.query(
      `update public.subscriptions set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where business_id = $1`,
      [businessId, ...keys.map((k) => fields[k])],
    ),
  );
}

async function usage(businessId: string, type: string, quantity: number, createdAt = "now()") {
  await asService((db) =>
    db.query(
      `insert into public.usage_events (business_id, event_type, quantity, unit, created_at) values ($1, $2, $3, 'unit', ${createdAt})`,
      [businessId, type, quantity],
    ),
  );
}

describe("get_business_entitlements", () => {
  it("returns an active trial with trial limits, role and zero usage for a new workspace", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const e = await entitlements(owner, b);
    expect(e).toMatchObject({
      access_active: true,
      reason: null,
      subscription_status: "trialing",
      is_trial: true,
      role: "owner",
      plan_id: "growth",
      limits: { ai_messages_per_month: 300, members: 3 },
      usage: { ai_messages: 0, ai_tokens: 0, voice_minutes: 0, members: 1, pending_invitations: 0 },
    });
    expect(e.agents).toHaveLength(3);
  });

  it("reports an expired trial using the database clock, without any status job", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await setTrialWindow(b, "-8 days", "-1 day");
    const e = await entitlements(owner, b);
    expect(e).toMatchObject({ access_active: false, reason: "trial_expired", subscription_status: "trialing" });
  });

  it("counts usage only inside the current period", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await usage(b, "ai_message", 5);
    await usage(b, "ai_input_tokens", 1000);
    await usage(b, "ai_output_tokens", 250);
    await usage(b, "ai_message", 99, "now() - interval '30 days'"); // before the trial started
    const e = await entitlements(owner, b);
    expect(e.usage).toMatchObject({ ai_messages: 5, ai_tokens: 1250 });
  });

  it("handles paid, past_due, canceled and incomplete states", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);

    await setSubscription(b, { status: "active", plan_id: "basic", current_period_start: new Date(Date.now() - 86400e3), current_period_end: new Date(Date.now() + 29 * 86400e3) });
    let e = await entitlements(owner, b);
    expect(e).toMatchObject({ access_active: true, is_trial: false, plan_id: "basic", limits: { agents: 1 } });

    await setSubscription(b, { status: "past_due" });
    e = await entitlements(owner, b);
    expect(e).toMatchObject({ access_active: true, reason: "payment_past_due" });

    await setSubscription(b, { status: "canceled" });
    e = await entitlements(owner, b);
    expect(e).toMatchObject({ access_active: true, reason: "cancels_at_period_end" });

    await setSubscription(b, { current_period_end: new Date(Date.now() - 1000) });
    e = await entitlements(owner, b);
    expect(e).toMatchObject({ access_active: false, reason: "subscription_canceled" });

    const second = await createWorkspace(owner, "No Trial Hotel");
    e = await entitlements(owner, second);
    expect(e).toMatchObject({ access_active: false, reason: "no_active_plan", subscription_status: "incomplete" });
  });

  it("refuses non-members and anonymous callers; the service variant is server-only", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const b = await createWorkspace(owner);
    await expect(entitlements(outsider, b)).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(null, (db) => db.query("select public.get_business_entitlements($1)", [b])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(owner, (db) => db.query("select public.get_business_entitlements_service($1)", [b])),
    ).rejects.toMatchObject({ code: "42501" });
    const svc = await asService(async (db) => (await db.query("select public.get_business_entitlements_service($1) as e", [b])).rows[0].e);
    expect(svc.access_active).toBe(true);
    expect(svc.role).toBeUndefined();
  });
});

async function invite(db: Db, businessId: string, email: string, role = "staff") {
  const { rows } = await db.query("select * from public.create_business_invitation($1, $2, $3::public.business_role)", [businessId, email, role]);
  return rows[0] as { invitation_id: string; token: string; expires_at: Date };
}

describe("team invitations", () => {
  it("owner invites, invitee accepts with the matching verified email and becomes a member", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const invitee = await createUser("new.staff@example.test");

    const inv = await asUser(owner, (db) => invite(db, b, "New.Staff@Example.test", "manager"), { commit: true });
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);

    const preview = await asUser(null, async (db) => (await db.query("select public.get_invitation_preview($1) as p", [inv.token])).rows[0].p);
    expect(preview).toMatchObject({ status: "valid", role: "manager", email: "new.staff@example.test", business_name: "Hotel Test" });

    const joined = await asUser(invitee, async (db) => (await db.query("select public.accept_business_invitation($1) as id", [inv.token])).rows[0].id, { commit: true });
    expect(joined).toBe(b);

    const { rows } = await pool.query("select role, invitation_status from public.business_members where business_id = $1 and user_id = $2", [b, invitee]);
    expect(rows[0]).toEqual({ role: "manager", invitation_status: "active" });

    // Single use.
    await expect(
      asUser(invitee, (db) => db.query("select public.accept_business_invitation($1)", [inv.token])),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("a different account cannot use a forwarded invitation link", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const attacker = await createUser("attacker@example.test");
    const inv = await asUser(owner, (db) => invite(db, b, "victim@example.test"), { commit: true });
    await expect(
      asUser(attacker, (db) => db.query("select public.accept_business_invitation($1)", [inv.token])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("an unverified account with the right email cannot accept", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const unverified = await createUser("unverified@example.test");
    await pool.query("update auth.users set email_confirmed_at = null where id = $1", [unverified]);
    const inv = await asUser(owner, (db) => invite(db, b, "unverified@example.test"), { commit: true });
    await expect(
      asUser(unverified, (db) => db.query("select public.accept_business_invitation($1)", [inv.token])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("enforces the role hierarchy", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const staff = await createUser();
    const b = await createWorkspace(owner);
    await addMember(b, admin, "admin");
    await addMember(b, staff, "staff");
    // 3 members already fill the trial's seat limit; use a plan with more seats.
    await setSubscription(b, { status: "active", plan_id: "business" });
    await expect(asUser(staff, (db) => invite(db, b, "x@example.test"))).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(admin, (db) => invite(db, b, "y@example.test", "admin"))).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(owner, (db) => invite(db, b, "z@example.test", "owner"))).rejects.toMatchObject({ code: "22023" });
    await expect(asUser(admin, (db) => invite(db, b, "w@example.test", "staff"))).resolves.toBeTruthy();
  });

  it("an outsider cannot invite into, or list invitations of, another business", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const b = await createWorkspace(owner);
    await asUser(owner, (db) => invite(db, b, "someone@example.test"), { commit: true });
    await expect(asUser(outsider, (db) => invite(db, b, "me@example.test", "admin"))).rejects.toMatchObject({ code: "42501" });
    const { rowCount } = await asUser(outsider, (db) => db.query("select id from public.business_invitations where business_id = $1", [b]));
    expect(rowCount).toBe(0);
  });

  it("token hashes are never readable by clients", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await asUser(owner, (db) => invite(db, b, "hash@example.test"), { commit: true });
    await expect(
      asUser(owner, (db) => db.query("select token_hash from public.business_invitations where business_id = $1", [b])),
    ).rejects.toMatchObject({ code: "42501" });
    const { rows } = await asUser(owner, (db) => db.query("select email, role from public.business_invitations where business_id = $1", [b]));
    expect(rows).toEqual([{ email: "hash@example.test", role: "staff" }]);
  });

  it("enforces the seat limit (trial: 3 members) counting pending invitations", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await asUser(owner, (db) => invite(db, b, "one@example.test"), { commit: true });
    await asUser(owner, (db) => invite(db, b, "two@example.test"), { commit: true });
    await expect(asUser(owner, (db) => invite(db, b, "three@example.test"))).rejects.toMatchObject({ code: "54000" });
    // Re-sending to an already-invited address replaces the old invite and does not need a new seat.
    await expect(asUser(owner, (db) => invite(db, b, "two@example.test"))).resolves.toBeTruthy();
  });

  it("re-sending invalidates the previous link; revoked and expired links cannot be used", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const invitee = await createUser("resend@example.test");
    const first = await asUser(owner, (db) => invite(db, b, "resend@example.test"), { commit: true });
    const second = await asUser(owner, (db) => invite(db, b, "resend@example.test"), { commit: true });
    await expect(asUser(invitee, (db) => db.query("select public.accept_business_invitation($1)", [first.token]))).rejects.toMatchObject({ code: "P0002" });

    await asUser(owner, (db) => db.query("select public.revoke_business_invitation($1)", [second.invitation_id]), { commit: true });
    await expect(asUser(invitee, (db) => db.query("select public.accept_business_invitation($1)", [second.token]))).rejects.toMatchObject({ code: "P0002" });

    const third = await asUser(owner, (db) => invite(db, b, "resend@example.test"), { commit: true });
    await asService((db) => db.query("update public.business_invitations set expires_at = now() - interval '1 minute' where id = $1", [third.invitation_id]));
    await expect(asUser(invitee, (db) => db.query("select public.accept_business_invitation($1)", [third.token]))).rejects.toMatchObject({ code: "55000" });
    const preview = await asUser(null, async (db) => (await db.query("select public.get_invitation_preview($1) as p", [third.token])).rows[0].p);
    expect(preview.status).toBe("expired");
  });

  it("cannot invite when the trial has expired", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await setTrialWindow(b, "-8 days", "-1 day");
    await expect(asUser(owner, (db) => invite(db, b, "late@example.test"))).rejects.toMatchObject({ code: "54001" });
  });

  it("refuses to invite someone who is already a member", async () => {
    const owner = await createUser("already-owner@example.test");
    const b = await createWorkspace(owner);
    await expect(asUser(owner, (db) => invite(db, b, "already-owner@example.test"))).rejects.toMatchObject({ code: "23505" });
  });

  it("previews reveal nothing for unknown or malformed tokens", async () => {
    for (const token of ["nope", "0".repeat(64), "'; drop table x; --"]) {
      const p = await asUser(null, async (db) => (await db.query("select public.get_invitation_preview($1) as p", [token])).rows[0].p);
      expect(p).toEqual({ status: "invalid" });
    }
  });
});

describe("agents and audit", () => {
  it("cannot enable an agent that is not available (voice not configured)", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await expect(
      asUser(owner, (db) => db.query("update public.agents set enabled = true where business_id = $1 and agent_type = 'voice_receptionist'", [b])),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("owners can configure agents; staff cannot; status/model config are not client-writable", async () => {
    const owner = await createUser();
    const staff = await createUser();
    const b = await createWorkspace(owner);
    await addMember(b, staff, "staff");
    const res = await asUser(staff, (db) => db.query("update public.agents set name = 'X' where business_id = $1", [b]));
    expect(res.rowCount).toBe(0);
    await asUser(owner, (db) =>
      db.query(
        `update public.agents set name = 'Front Desk', system_configuration = '{"tone":"friendly"}', enabled = false
         where business_id = $1 and agent_type = 'website_receptionist'`,
        [b],
      ),
    { commit: true });
    await expect(
      asUser(owner, (db) => db.query("update public.agents set status = 'ready' where business_id = $1", [b])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(owner, (db) => db.query(`update public.agents set model_configuration = '{"model":"x"}' where business_id = $1`, [b])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("records agent and business configuration changes in the audit log (field names only)", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await asUser(owner, (db) => db.query("update public.businesses set phone = '+49 30 1234' where id = $1", [b]), { commit: true });
    await asUser(owner, (db) => db.query("update public.agents set enabled = false where business_id = $1 and agent_type = 'website_receptionist'", [b]), { commit: true });
    const { rows } = await pool.query(
      "select action, actor_id, metadata from public.audit_logs where business_id = $1 and action in ('business.updated','agent.updated') order by id",
      [b],
    );
    expect(rows).toEqual([
      { action: "business.updated", actor_id: owner, metadata: { changed: ["phone"] } },
      { action: "agent.updated", actor_id: owner, metadata: { changed: ["enabled"] } },
    ]);
    expect(JSON.stringify(rows)).not.toContain("1234");
  });
});
