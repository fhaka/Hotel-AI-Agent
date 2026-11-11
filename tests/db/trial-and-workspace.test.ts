import { afterAll, describe, expect, it } from "vitest";
import { asService, asUser, createUser, createWorkspace, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("workspace creation", () => {
  it("creates business, owner membership, settings, trial and default agents atomically", async () => {
    const user = await createUser();
    const before = Date.now();
    const businessId = await createWorkspace(user, "Seaside Inn");

    const { rows } = await asUser(user, async (db) => ({
      rows: {
        members: (await db.query("select user_id, role, invitation_status from public.business_members where business_id = $1", [businessId])).rows,
        settings: (await db.query("select 1 from public.business_settings where business_id = $1", [businessId])).rowCount,
        sub: (await db.query("select status, plan_id, trial_started_at, trial_ends_at from public.subscriptions where business_id = $1", [businessId])).rows[0],
        agents: (await db.query("select agent_type, enabled, status from public.agents where business_id = $1 order by agent_type", [businessId])).rows,
      },
    }));

    expect(rows.members).toEqual([{ user_id: user, role: "owner", invitation_status: "active" }]);
    expect(rows.settings).toBe(1);
    expect(rows.sub.status).toBe("trialing");
    expect(rows.sub.plan_id).toBe("growth");

    // Trial starts at workspace creation and lasts exactly 7 days.
    const started = new Date(rows.sub.trial_started_at).getTime();
    const ends = new Date(rows.sub.trial_ends_at).getTime();
    expect(started).toBeGreaterThanOrEqual(before - 5_000);
    expect(started).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(ends - started).toBe(7 * 24 * 60 * 60 * 1000);

    expect(rows.agents).toEqual([
      { agent_type: "website_receptionist", enabled: true, status: "draft" },
      { agent_type: "reservation_assistant", enabled: true, status: "draft" },
      { agent_type: "voice_receptionist", enabled: false, status: "not_configured" },
    ]);
  });

  it("does not enable the reservation assistant for non-hotel businesses", async () => {
    const user = await createUser();
    const businessId = await createWorkspace(user, "Trattoria", "restaurant");
    const { rows } = await pool.query(
      "select enabled, status from public.agents where business_id = $1 and agent_type = 'reservation_assistant'",
      [businessId],
    );
    expect(rows[0]).toEqual({ enabled: false, status: "disabled" });
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      asUser(null, (db) => db.query("select public.create_business_workspace('X Hotel', 'hotel')")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("validates input on the server", async () => {
    const user = await createUser();
    await expect(
      asUser(user, (db) => db.query("select public.create_business_workspace('X', 'hotel')")),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      asUser(user, (db) => db.query("select public.create_business_workspace('Valid Name', 'hotel', 'Mars/Olympus')")),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("cannot be bypassed by inserting a business directly", async () => {
    const user = await createUser();
    await expect(
      asUser(user, (db) =>
        db.query("insert into public.businesses (name, industry, created_by) values ('Direct', 'hotel', auth.uid())"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("trial integrity", () => {
  it("a user only gets one free trial, even with a second workspace", async () => {
    const user = await createUser();
    await createWorkspace(user, "First Hotel");
    const second = await createWorkspace(user, "Second Hotel");
    const { rows } = await pool.query(
      "select status, trial_started_at, trial_ends_at from public.subscriptions where business_id = $1",
      [second],
    );
    expect(rows[0]).toEqual({ status: "incomplete", trial_started_at: null, trial_ends_at: null });
  });

  it("concurrent workspace creation cannot grant two trials", async () => {
    const user = await createUser();
    const ids = await Promise.all([
      createWorkspace(user, "Race One"),
      createWorkspace(user, "Race Two"),
      createWorkspace(user, "Race Three"),
    ]);
    const { rows } = await pool.query(
      "select count(*)::int as n from public.subscriptions where business_id = any($1) and status = 'trialing'",
      [ids],
    );
    expect(rows[0].n).toBe(1);
  });

  it("members cannot extend the trial or change subscription status", async () => {
    const user = await createUser();
    const businessId = await createWorkspace(user);
    await expect(
      asUser(user, (db) =>
        db.query("update public.subscriptions set trial_ends_at = now() + interval '1 year' where business_id = $1", [
          businessId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(user, (db) =>
        db.query("update public.subscriptions set status = 'active' where business_id = $1", [businessId]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(user, (db) => db.query("delete from public.trial_grants where user_id = auth.uid()")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("trial dates are immutable even for the service role unless explicitly overridden", async () => {
    const user = await createUser();
    const businessId = await createWorkspace(user);
    await expect(
      asService((db) =>
        db.query("update public.subscriptions set trial_ends_at = trial_ends_at + interval '30 days' where business_id = $1", [
          businessId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Status changes (e.g. from a verified webhook) are still allowed.
    await asService((db) =>
      db.query("update public.subscriptions set status = 'active' where business_id = $1", [businessId]),
    );
  });

  it("platform settings, trial grants and webhook events are not readable by clients", async () => {
    const user = await createUser();
    for (const table of ["platform_settings", "trial_grants", "webhook_events"]) {
      await expect(asUser(user, (db) => db.query(`select * from public.${table}`)), table).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("webhook events are unique per provider event id", async () => {
    await asService((db) =>
      db.query("insert into public.webhook_events (provider, provider_event_id, event_type) values ('paddle', 'evt_1', 'subscription.activated')"),
    );
    await expect(
      asService((db) =>
        db.query("insert into public.webhook_events (provider, provider_event_id, event_type) values ('paddle', 'evt_1', 'subscription.activated')"),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
