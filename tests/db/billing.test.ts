import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

function checkout(userId: string, businessId: string, plan = "growth", interval = "month") {
  return asUser(
    userId,
    async (db) =>
      (await db.query("select public.create_checkout_session($1, $2, $3::public.billing_interval, 'paddle', 'pri_test_growth_m') as id", [businessId, plan, interval]))
        .rows[0].id as string,
    { commit: true },
  );
}

type Sub = {
  id: string;
  customer_id?: string;
  status: string;
  plan_id: string;
  interval?: string;
  period_start?: string;
  period_end?: string;
  cancel_at_period_end?: boolean;
  checkout_id?: string;
};

function apply(eventId: string, type: string, occurredAt: Date, sub: Sub | null, related: string | null = null) {
  return asService(async (db) =>
    (
      await db.query("select public.apply_billing_event('paddle', $1, $2, $3, $4, $5, $6) as r", [
        eventId,
        type,
        occurredAt.toISOString(),
        sub ? JSON.stringify(sub) : null,
        related,
        JSON.stringify({ test: true }),
      ])
    ).rows[0].r,
  );
}

async function entitlements(userId: string, businessId: string) {
  return asUser(userId, async (db) => (await db.query("select public.get_business_entitlements($1) as e", [businessId])).rows[0].e);
}

const now = Date.now();
const at = (minutes: number) => new Date(now + minutes * 60_000);
const period = { period_start: new Date(now - 86_400_000).toISOString(), period_end: new Date(now + 29 * 86_400_000).toISOString() };

describe("checkout sessions", () => {
  it("only owners can start a checkout", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const b = await createWorkspace(owner);
    await addMember(b, admin, "admin");
    await expect(checkout(admin, b)).rejects.toMatchObject({ code: "42501" });
    expect(await checkout(owner, b)).toMatch(/^[0-9a-f-]{36}$/);
    await expect(checkout(owner, b, "nonexistent")).rejects.toMatchObject({ code: "22023" });
  });

  it("checkout sessions are not readable or writable by clients", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await checkout(owner, b);
    await expect(asUser(owner, (db) => db.query("select * from public.billing_checkout_sessions"))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("apply_billing_event", () => {
  it("activates a paid subscription only via a verified event, resolving the business from the checkout session", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const checkoutId = await checkout(owner, b);
    expect((await entitlements(owner, b)).subscription_status).toBe("trialing");

    const subId = `sub_${randomUUID()}`;
    const r = await apply(`evt_${randomUUID()}`, "subscription.created", at(0), {
      id: subId, customer_id: "ctm_1", status: "active", plan_id: "growth", interval: "month", ...period, cancel_at_period_end: false, checkout_id: checkoutId,
    });
    expect(r).toMatchObject({ result: "applied", business_id: b, status: "active" });

    const e = await entitlements(owner, b);
    expect(e).toMatchObject({ access_active: true, subscription_status: "active", plan_id: "growth", is_trial: false, billing_interval: "month" });
    const { rows } = await pool.query("select billing_provider, provider_customer_id, provider_subscription_id, trial_started_at is not null as kept_trial, (select completed_at is not null from public.billing_checkout_sessions where id = $2) as checkout_done from public.subscriptions where business_id = $1", [b, checkoutId]);
    expect(rows[0]).toEqual({ billing_provider: "paddle", provider_customer_id: "ctm_1", provider_subscription_id: subId, kept_trial: true, checkout_done: true });
  });

  it("is idempotent per provider event id", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const checkoutId = await checkout(owner, b);
    const ev = `evt_${randomUUID()}`;
    const sub = { id: `sub_${randomUUID()}`, status: "active", plan_id: "growth", interval: "month", ...period, checkout_id: checkoutId };
    expect((await apply(ev, "subscription.created", at(0), sub)).result).toBe("applied");
    expect((await apply(ev, "subscription.created", at(0), sub)).result).toBe("duplicate");
    const { rows } = await pool.query("select count(*)::int as n from public.subscription_events where business_id = $1", [b]);
    expect(rows[0].n).toBe(1);
  });

  it("ignores out-of-order (older) events but records them", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const checkoutId = await checkout(owner, b);
    const subId = `sub_${randomUUID()}`;
    const base = { id: subId, plan_id: "growth", interval: "month", ...period, checkout_id: checkoutId };
    await apply(`evt_${randomUUID()}`, "subscription.past_due", at(10), { ...base, status: "past_due" });
    const late = await apply(`evt_${randomUUID()}`, "subscription.activated", at(5), { ...base, status: "active" });
    expect(late.result).toBe("stale");
    expect((await entitlements(owner, b)).subscription_status).toBe("past_due");
  });

  it("a tampered or unknown checkout id cannot attach a subscription to a business", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const r = await apply(`evt_${randomUUID()}`, "subscription.created", at(0), {
      id: `sub_${randomUUID()}`, status: "active", plan_id: "business", interval: "year", ...period, checkout_id: randomUUID(),
    });
    expect(r).toEqual({ result: "unresolved" });
    expect((await entitlements(owner, b)).subscription_status).toBe("trialing");
    const failed = await pool.query("select processing_status from public.webhook_events order by created_at desc limit 1");
    expect(failed.rows[0].processing_status).toBe("failed");
  });

  it("never attaches one provider subscription to two businesses", async () => {
    const o1 = await createUser();
    const o2 = await createUser();
    const b1 = await createWorkspace(o1, "One");
    const b2 = await createWorkspace(o2, "Two");
    const subId = `sub_${randomUUID()}`;
    await apply(`evt_${randomUUID()}`, "subscription.created", at(0), { id: subId, status: "active", plan_id: "growth", interval: "month", ...period, checkout_id: await checkout(o1, b1) });
    const r = await apply(`evt_${randomUUID()}`, "subscription.updated", at(1), { id: subId, status: "active", plan_id: "business", interval: "month", ...period, checkout_id: await checkout(o2, b2) });
    // Resolved by the existing subscription id -> stays on business 1.
    expect(r.business_id).toBe(b1);
    expect((await entitlements(o2, b2)).subscription_status).toBe("trialing");
  });

  it("flags a second live subscription for the same business as a conflict instead of replacing it", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    await apply(`evt_${randomUUID()}`, "subscription.created", at(0), { id: `sub_${randomUUID()}`, status: "active", plan_id: "growth", interval: "month", ...period, checkout_id: await checkout(owner, b) });
    // Checkout is blocked once a paid subscription is live...
    await expect(checkout(owner, b)).rejects.toMatchObject({ code: "55000" });
    // ...and a stray second subscription is not silently applied.
    const sessionId = (await pool.query("select id from public.billing_checkout_sessions where business_id = $1 limit 1", [b])).rows[0].id;
    const r = await apply(`evt_${randomUUID()}`, "subscription.created", at(1), { id: `sub_${randomUUID()}`, status: "active", plan_id: "business", interval: "year", ...period, checkout_id: sessionId });
    expect(r.result).toBe("conflict");
    expect((await entitlements(owner, b)).plan_id).toBe("growth");
  });

  it("maps lifecycle states to the right entitlements", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const subId = `sub_${randomUUID()}`;
    const base = { id: subId, plan_id: "growth", interval: "month", checkout_id: await checkout(owner, b) };
    await apply(`evt_${randomUUID()}`, "subscription.updated", at(1), { ...base, status: "active", ...period, cancel_at_period_end: true });
    expect(await entitlements(owner, b)).toMatchObject({ access_active: true, cancel_at_period_end: true });
    await apply(`evt_${randomUUID()}`, "subscription.canceled", at(2), { ...base, status: "canceled", period_start: period.period_start, period_end: new Date(now - 1000).toISOString() });
    expect(await entitlements(owner, b)).toMatchObject({ access_active: false, reason: "subscription_canceled" });
  });

  it("records payment events against the business via the related subscription", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const subId = `sub_${randomUUID()}`;
    await apply(`evt_${randomUUID()}`, "subscription.created", at(0), { id: subId, status: "active", plan_id: "growth", interval: "month", ...period, checkout_id: await checkout(owner, b) });
    const r = await apply(`evt_${randomUUID()}`, "transaction.payment_failed", at(1), null, subId);
    expect(r).toMatchObject({ result: "recorded", business_id: b });
    const hist = await asUser(owner, (db) => db.query("select event_type, outcome from public.subscription_events where business_id = $1 order by id", [b]));
    expect(hist.rows).toEqual([
      { event_type: "subscription.created", outcome: "applied" },
      { event_type: "transaction.payment_failed", outcome: "recorded" },
    ]);
  });

  it("rejects invalid payloads (unknown plan, trialing from provider)", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const c = await checkout(owner, b);
    expect((await apply(`evt_${randomUUID()}`, "subscription.created", at(0), { id: `sub_${randomUUID()}`, status: "active", plan_id: "platinum", ...period, checkout_id: c })).result).toBe("invalid");
    expect((await apply(`evt_${randomUUID()}`, "subscription.created", at(0), { id: `sub_${randomUUID()}`, status: "trialing", plan_id: "growth", ...period, checkout_id: c })).result).toBe("invalid");
  });
});

describe("client access", () => {
  it("clients cannot apply billing events or see other businesses' history", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const b = await createWorkspace(owner);
    await expect(
      asUser(owner, (db) => db.query("select public.apply_billing_event('paddle', 'x', 'subscription.created', now(), '{}', null, '{}')")),
    ).rejects.toMatchObject({ code: "42501" });
    const { rowCount } = await asUser(outsider, (db) => db.query("select * from public.subscription_events where business_id = $1", [b]));
    expect(rowCount).toBe(0);
  });
});
