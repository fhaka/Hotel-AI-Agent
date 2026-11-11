import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool } from "./helpers";

/** ISO date n days from today in Europe/Berlin (the test workspaces' time zone). */
async function berlinDate(n: number): Promise<string> {
  const { rows } = await pool.query("select ((now() at time zone 'Europe/Berlin')::date + $1::int)::text as d", [n]);
  return rows[0].d;
}

afterAll(async () => {
  await pool.end();
});

// Each test needs a clean outbox view for its own business; other tests'
// businesses may also enqueue, so assertions always filter by business_id.
beforeEach(async () => {
  await asService((db) => db.query("delete from public.notifications"));
});

const enqueue = () => asService(async (db) => (await db.query("select public.enqueue_due_notifications() as c")).rows[0].c);

async function outbox(businessId: string) {
  const { rows } = await pool.query(
    "select kind, recipient_email, recipient_type, status from public.notifications where business_id = $1 order by kind, recipient_email",
    [businessId],
  );
  return rows;
}

async function hotelWithBooking(opts: { daysAhead: number; email?: string | null; plan?: string } = { daysAhead: 2 }) {
  const owner = await createUser(`owner-${Math.random().toString(36).slice(2)}@example.test`);
  const b = await createWorkspace(owner, "Auto Hotel");
  await asUser(
    owner,
    (db) =>
      db.query("select public.save_onboarding_hotel($1, $2, '{}', $3)", [
        b,
        JSON.stringify({ check_in_time: "14:00", currency: "EUR" }),
        JSON.stringify([{ name: "Double", maximum_guests: 2, amenities: [], base_price_cents: 10000, room_numbers: ["1"] }]),
      ]),
    { commit: true },
  );
  if (opts.plan) await asService((db) => db.query("update public.subscriptions set status = 'active', plan_id = $2 where business_id = $1", [b, opts.plan]));
  const checkIn = await berlinDate(opts.daysAhead);
  const checkOut = await berlinDate(opts.daysAhead + 1);
  const res = await asService(async (db) => {
    const room = (await db.query("select id from public.rooms where business_id = $1", [b])).rows[0].id;
    const guest = (await db.query("insert into public.guests (business_id, full_name, email) values ($1, 'Gina Guest', $2) returning id", [b, opts.email === undefined ? "gina@example.test" : opts.email])).rows[0].id;
    return (await db.query(
      "insert into public.reservations (business_id, room_id, guest_id, check_in, check_out, guests_count, total_price_cents, status) values ($1, $2, $3, $4, $5, 1, 10000, 'confirmed') returning id",
      [b, room, guest, checkIn, checkOut],
    )).rows[0].id as string;
  });
  return { owner, b, reservationId: res };
}

describe("enqueue_due_notifications", () => {
  it("queues a pre-arrival reminder 2 days before check-in, exactly once", async () => {
    const { b } = await hotelWithBooking({ daysAhead: 2 });
    await enqueue();
    await enqueue(); // idempotent
    const rows = (await outbox(b)).filter((r) => r.kind === "guest_pre_arrival");
    expect(rows).toEqual([{ kind: "guest_pre_arrival", recipient_email: "gina@example.test", recipient_type: "guest", status: "pending" }]);
  });

  it("respects the days-before preference, disabled preference, missing email and plan features", async () => {
    const notToday = await hotelWithBooking({ daysAhead: 3 });
    const noEmail = await hotelWithBooking({ daysAhead: 2, email: null });
    const basicPlan = await hotelWithBooking({ daysAhead: 2, plan: "basic" }); // Basic has no 'automations'
    const disabled = await hotelWithBooking({ daysAhead: 2 });
    await asService((db) =>
      db.query(`update public.business_settings set notification_preferences = '{"guest_pre_arrival":{"enabled":false}}' where business_id = $1`, [disabled.b]),
    );
    const custom = await hotelWithBooking({ daysAhead: 3 });
    await asService((db) =>
      db.query(`update public.business_settings set notification_preferences = '{"guest_pre_arrival":{"enabled":true,"days_before":3}}' where business_id = $1`, [custom.b]),
    );
    await enqueue();
    for (const h of [notToday, noEmail, basicPlan, disabled]) {
      expect((await outbox(h.b)).some((r) => r.kind === "guest_pre_arrival")).toBe(false);
    }
    expect((await outbox(custom.b)).some((r) => r.kind === "guest_pre_arrival")).toBe(true);
  });

  it("does not remind guests of an expired-trial business", async () => {
    const h = await hotelWithBooking({ daysAhead: 2 });
    await asService(async (db) => {
      await db.query("select set_config('hotelai.allow_trial_edit', 'on', true)");
      await db.query("update public.subscriptions set trial_started_at = now() - interval '8 days', trial_ends_at = now() - interval '1 day' where business_id = $1", [h.b]);
    });
    await enqueue();
    const kinds = (await outbox(h.b)).map((r) => r.kind);
    expect(kinds).not.toContain("guest_pre_arrival");
    expect(kinds).toContain("owner_trial_ended");
  });

  it("queues trial-ending notices to owners only, and the welcome email", async () => {
    const owner = await createUser("ending-owner@example.test");
    const staff = await createUser("ending-staff@example.test");
    const b = await createWorkspace(owner, "Ending Hotel");
    await addMember(b, staff, "staff");
    await asService(async (db) => {
      await db.query("select set_config('hotelai.allow_trial_edit', 'on', true)");
      await db.query("update public.subscriptions set trial_ends_at = now() + interval '20 hours' where business_id = $1", [b]);
    });
    await enqueue();
    expect(await outbox(b)).toEqual([
      { kind: "owner_trial_ending", recipient_email: "ending-owner@example.test", recipient_type: "owner", status: "pending" },
      { kind: "owner_welcome", recipient_email: "ending-owner@example.test", recipient_type: "owner", status: "pending" },
    ]);
  });

  it("alerts staff about live escalations (not playground) and later about unanswered ones", async () => {
    const owner = await createUser("esc-owner@example.test");
    const admin = await createUser("esc-admin@example.test");
    const b = await createWorkspace(owner, "Esc Hotel");
    await addMember(b, admin, "admin");
    const agent = (await pool.query("select id from public.agents where business_id = $1 and agent_type = 'website_receptionist'", [b])).rows[0].id;
    const [live, test] = await asService(async (db) => {
      const mk = async (channel: string, hoursAgo: number) =>
        (await db.query(
          "insert into public.agent_conversations (business_id, agent_id, channel, status, escalated_at) values ($1, $2, $3, 'escalated', now() - make_interval(hours => $4)) returning id",
          [b, agent, channel, hoursAgo],
        )).rows[0].id;
      return [await mk("website", 5), await mk("playground", 5)];
    });
    await enqueue();
    const rows = await pool.query("select kind, recipient_email, subject_id from public.notifications where business_id = $1 and kind like 'staff_%' order by kind, recipient_email", [b]);
    expect(rows.rows).toEqual([
      { kind: "staff_escalation", recipient_email: "esc-admin@example.test", subject_id: live },
      { kind: "staff_escalation", recipient_email: "esc-owner@example.test", subject_id: live },
      { kind: "staff_unanswered_inquiry", recipient_email: "esc-admin@example.test", subject_id: live },
      { kind: "staff_unanswered_inquiry", recipient_email: "esc-owner@example.test", subject_id: live },
    ]);
    expect(rows.rows.some((r) => r.subject_id === test)).toBe(false);

    // A configured alert address replaces the owner/admin list.
    await asService(async (db) => {
      await db.query("delete from public.notifications where business_id = $1", [b]);
      await db.query(`update public.business_settings set notification_preferences = '{"staff_alerts":{"enabled":true,"email":"Desk@Esc.example"}}' where business_id = $1`, [b]);
    });
    await enqueue();
    const custom = await pool.query("select distinct recipient_email from public.notifications where business_id = $1 and kind = 'staff_escalation'", [b]);
    expect(custom.rows).toEqual([{ recipient_email: "desk@esc.example" }]);
  });

  it("queues payment-failed notices for past_due subscriptions", async () => {
    const owner = await createUser("pay-owner@example.test");
    const b = await createWorkspace(owner, "Pay Hotel");
    await asService((db) => db.query("update public.subscriptions set status = 'past_due', provider_subscription_id = 'sub_pay', current_period_end = now() + interval '3 days' where business_id = $1", [b]));
    await enqueue();
    expect((await outbox(b)).map((r) => r.kind)).toContain("owner_payment_failed");
  });
});

describe("claim / complete", () => {
  async function seed(n: number) {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Queue Hotel");
    await asService((db) =>
      db.query(
        "insert into public.notifications (business_id, kind, recipient_email, recipient_type, dedupe_key) select $1::uuid, 'owner_welcome', 'x' || g || '@example.test', 'owner', 'seed:' || $1::text || ':' || g from generate_series(1, $2::int) g",
        [b, n],
      ),
    );
    return b;
  }
  const claim = (limit: number) => asService(async (db) => (await db.query("select * from public.claim_notifications($1)", [limit])).rows);
  const complete = (id: string, outcome: string) =>
    asService(async (db) => (await db.query("select public.complete_notification($1, $2, 'err', null) as s", [id, outcome])).rows[0].s);

  it("parallel workers never claim the same notification", async () => {
    await seed(30);
    const batches = await Promise.all([claim(10), claim(10), claim(10), claim(10)]);
    const ids = batches.flat().map((r) => r.id);
    expect(ids.length).toBe(30);
    expect(new Set(ids).size).toBe(30);
    expect(batches.flat().every((r) => r.status === "sending" && r.attempts === 1)).toBe(true);
  });

  it("retries with backoff and gives up after 5 attempts", async () => {
    await seed(1);
    let [n] = await claim(5);
    expect(await complete(n.id, "retry")).toBe("pending");
    const { rows } = await pool.query("select next_attempt_at > now() + interval '1 minute' as later from public.notifications where id = $1", [n.id]);
    expect(rows[0].later).toBe(true);
    expect(await claim(5)).toEqual([]); // not due yet
    for (let i = 2; i <= 5; i++) {
      await asService((db) => db.query("update public.notifications set next_attempt_at = now() - interval '1 second' where id = $1", [n.id]));
      [n] = await claim(5);
      expect(n.attempts).toBe(i);
      expect(await complete(n.id, "retry")).toBe(i < 5 ? "pending" : "failed");
    }
  });

  it("records sent and skipped outcomes", async () => {
    await seed(2);
    const [a, b] = await claim(5);
    expect(await complete(a.id, "sent")).toBe("sent");
    expect(await complete(b.id, "skipped")).toBe("skipped");
    const { rows } = await pool.query("select status, sent_at is not null as has_sent_at from public.notifications where id = any($1) order by status", [[a.id, b.id]]);
    expect(rows).toEqual([{ status: "sent", has_sent_at: true }, { status: "skipped", has_sent_at: false }]);
  });

  it("reclaims notifications stuck in 'sending'", async () => {
    await seed(1);
    const [n] = await claim(5);
    await asService((db) => db.query("update public.notifications set next_attempt_at = now() - interval '20 minutes' where id = $1", [n.id]));
    const [again] = await claim(5);
    expect(again.id).toBe(n.id);
    expect(again.attempts).toBe(2);
  });
});

describe("access", () => {
  it("owners/admins read their own log; job functions are service-only", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const b = await createWorkspace(owner, "Log Hotel");
    await enqueue();
    expect((await asUser(owner, (db) => db.query("select kind from public.notifications where business_id = $1", [b]))).rowCount).toBeGreaterThan(0);
    expect((await asUser(outsider, (db) => db.query("select kind from public.notifications where business_id = $1", [b]))).rowCount).toBe(0);
    for (const sql of ["select public.enqueue_due_notifications()", "select * from public.claim_notifications(1)", "select public.expire_trials()"]) {
      await expect(asUser(owner, (db) => db.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("expire_trials marks ended trials as expired and access stays off", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Expire Hotel");
    await asService(async (db) => {
      await db.query("select set_config('hotelai.allow_trial_edit', 'on', true)");
      await db.query("update public.subscriptions set trial_started_at = now() - interval '8 days', trial_ends_at = now() - interval '1 day' where business_id = $1", [b]);
    });
    await asService((db) => db.query("select public.expire_trials()"));
    const e = await asUser(owner, async (db) => (await db.query("select public.get_business_entitlements($1) as e", [b])).rows[0].e);
    expect(e).toMatchObject({ subscription_status: "expired", access_active: false, reason: "trial_expired" });
  });
});

describe("resolve_conversation", () => {
  it("members can close a hand-over; it then stops unanswered alerts; outsiders can't", async () => {
    const owner = await createUser("res-owner@example.test");
    const staff = await createUser();
    const outsider = await createUser();
    const b = await createWorkspace(owner, "Resolve Hotel");
    await addMember(b, staff, "staff");
    const agent = (await pool.query("select id from public.agents where business_id = $1 and agent_type = 'website_receptionist'", [b])).rows[0].id;
    const conv = (await asService((db) => db.query("insert into public.agent_conversations (business_id, agent_id, channel, status, escalated_at) values ($1, $2, 'website', 'escalated', now() - interval '6 hours') returning id", [b, agent]))).rows[0].id;
    await expect(asUser(outsider, (db) => db.query("select public.resolve_conversation($1)", [conv]))).rejects.toMatchObject({ code: "P0002" });
    await asUser(staff, (db) => db.query("select public.resolve_conversation($1)", [conv]), { commit: true });
    await enqueue();
    const kinds = (await outbox(b)).map((r) => r.kind);
    expect(kinds).not.toContain("staff_unanswered_inquiry");
    expect(kinds).not.toContain("staff_escalation");
  });
});
