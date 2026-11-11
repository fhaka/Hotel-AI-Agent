import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool, type Db } from "./helpers";

/** ISO date n days from today (UTC). Tests keep >= 2 days away from "today" to avoid time-zone edges. */
const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let owner: string;
let staff: string;
let outsider: string;
let hotel: string;
let doubleType: string;
let suiteType: string;

async function setupHotel(user: string, name: string) {
  const b = await createWorkspace(user, name);
  await asUser(
    user,
    (db) =>
      db.query("select public.save_onboarding_hotel($1, $2, $3, $4)", [
        b,
        JSON.stringify({ check_in_time: "14:00", check_out_time: "11:00", currency: "EUR" }),
        JSON.stringify({}),
        JSON.stringify([
          { name: "Double", maximum_guests: 2, amenities: [], base_price_cents: 10000, room_numbers: ["101", "102"] },
          { name: "Suite", maximum_guests: 4, amenities: [], base_price_cents: 20000, room_numbers: ["201"] },
        ]),
      ]),
    { commit: true },
  );
  return b;
}

async function typeId(businessId: string, name: string) {
  const { rows } = await pool.query("select id from public.room_types where business_id = $1 and name = $2", [businessId, name]);
  return rows[0].id as string;
}

function search(db: Db, businessId: string, checkIn: string, checkOut: string, guests: number) {
  return db.query("select * from public.search_room_availability($1, $2::date, $3::date, $4) order by name", [businessId, checkIn, checkOut, guests]);
}

function staffBook(
  userId: string,
  businessId: string,
  roomType: string,
  checkIn: string,
  checkOut: string,
  opts: { guests?: number; email?: string; name?: string; key?: string | null; commit?: boolean } = {},
) {
  return asUser(
    userId,
    async (db) =>
      (
        await db.query("select public.create_reservation($1, $2, null, $3::date, $4::date, $5, $6, null, $7) as r", [
          businessId,
          roomType,
          checkIn,
          checkOut,
          opts.guests ?? 2,
          JSON.stringify({ full_name: opts.name ?? "Ada Guest", email: opts.email ?? "ada@example.test" }),
          opts.key ?? null,
        ])
      ).rows[0].r,
    { commit: opts.commit ?? true },
  );
}

beforeAll(async () => {
  owner = await createUser();
  staff = await createUser();
  outsider = await createUser();
  hotel = await setupHotel(owner, "Engine Hotel");
  await addMember(hotel, staff, "staff");
  doubleType = await typeId(hotel, "Double");
  suiteType = await typeId(hotel, "Suite");
  // Seasonal rate: nights d(20) and d(21) cost 150 instead of 100.
  await asUser(
    owner,
    (db) =>
      db.query(
        "insert into public.room_type_rates (business_id, room_type_id, name, starts_on, ends_on, nightly_price_cents) values ($1, $2, 'Festival', $3::date, $4::date, 15000)",
        [hotel, doubleType, d(20), d(22)],
      ),
    { commit: true },
  );
});

afterAll(async () => {
  await pool.end();
});

describe("availability and pricing", () => {
  it("returns per-type availability and server-calculated totals including seasonal rates", async () => {
    const { rows } = await asUser(staff, (db) => search(db, hotel, d(19), d(23), 2));
    expect(rows.map((r) => [r.name, r.available_rooms, r.nights, r.total_price_cents])).toEqual([
      ["Double", 2, 4, 10000 + 15000 + 15000 + 10000],
      ["Suite", 1, 4, 80000],
    ]);
  });

  it("filters by party size", async () => {
    const { rows } = await asUser(staff, (db) => search(db, hotel, d(30), d(31), 3));
    expect(rows.map((r) => r.name)).toEqual(["Suite"]);
  });

  it("rejects invalid date ranges", async () => {
    for (const [ci, co] of [
      [d(10), d(10)],
      [d(10), d(9)],
      [d(-3), d(1)],
      [d(10), d(41)], // > 30 nights default
      [d(400), d(401)],
    ]) {
      await expect(asUser(staff, (db) => search(db, hotel, ci, co, 2)), `${ci}..${co}`).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("returns nothing for a business the caller does not belong to", async () => {
    const { rowCount } = await asUser(outsider, (db) => search(db, hotel, d(50), d(51), 2));
    expect(rowCount).toBe(0);
  });
});

describe("staff bookings", () => {
  it("allocates free rooms in order, then reports sold out", async () => {
    const a = await staffBook(staff, hotel, doubleType, d(60), d(62), { email: "a@example.test" });
    const b = await staffBook(staff, hotel, doubleType, d(61), d(63), { email: "b@example.test" });
    expect([a.room_number, b.room_number]).toEqual(["101", "102"]);
    expect(a).toMatchObject({ status: "confirmed", nights: 2, total_price_cents: 20000, currency: "EUR", room_type: "Double" });
    await expect(staffBook(staff, hotel, doubleType, d(61), d(62), { email: "c@example.test" })).rejects.toMatchObject({ code: "23P01" });
    const { rows } = await asUser(staff, (db) => search(db, hotel, d(61), d(62), 2));
    expect(rows.find((r) => r.name === "Double").available_rooms).toBe(0);
  });

  it("concurrent bookings never exceed inventory", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => staffBook(staff, hotel, doubleType, d(70), d(72), { email: `race${i}@example.test` })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]).every((r) => r.reason.code === "23P01")).toBe(true);
  });

  it("reuses the guest by email, is idempotent per key, and records history", async () => {
    const first = await staffBook(staff, hotel, suiteType, d(80), d(81), { email: "Repeat@Example.test", key: "form-123" });
    const again = await staffBook(staff, hotel, suiteType, d(80), d(81), { email: "repeat@example.test", key: "form-123" });
    expect(again).toMatchObject({ id: first.id, duplicate: true });
    const second = await staffBook(staff, hotel, suiteType, d(82), d(83), { email: "repeat@example.test" });
    const guests = await pool.query("select count(distinct guest_id)::int as n from public.reservations where id = any($1)", [[first.id, second.id]]);
    expect(guests.rows[0].n).toBe(1);
    const ev = await asUser(staff, (db) => db.query("select event_type, to_status, actor_id from public.reservation_events where reservation_id = $1", [first.id]));
    expect(ev.rows).toEqual([{ event_type: "created", to_status: "confirmed", actor_id: staff }]);
  });

  it("enforces party size, membership and active subscription", async () => {
    await expect(staffBook(staff, hotel, doubleType, d(90), d(91), { guests: 3 })).rejects.toMatchObject({ code: "22023" });
    await expect(staffBook(outsider, hotel, doubleType, d(90), d(91))).rejects.toMatchObject({ code: "42501" });
    const other = await createUser();
    const otherHotel = await setupHotel(other, "Expired Hotel");
    await asService(async (db) => {
      await db.query("select set_config('hotelai.allow_trial_edit', 'on', true)");
      await db.query("update public.subscriptions set trial_started_at = now() - interval '8 days', trial_ends_at = now() - interval '1 day' where business_id = $1", [otherHotel]);
    });
    await expect(staffBook(other, otherHotel, await typeId(otherHotel, "Double"), d(10), d(11))).rejects.toMatchObject({ code: "54001" });
  });

  it("cannot book another business's room type", async () => {
    const other = await createUser();
    const otherHotel = await setupHotel(other, "Foreign Hotel");
    await expect(staffBook(owner, hotel, await typeId(otherHotel, "Double"), d(95), d(96))).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("modifications and status", () => {
  it("changes dates, recalculates the price, and moves rooms when needed", async () => {
    const r = await staffBook(staff, hotel, doubleType, d(100), d(102), { email: "mod@example.test" });
    expect(r.room_number).toBe("101");
    const blocker = await staffBook(staff, hotel, doubleType, d(104), d(106), { email: "block@example.test" });
    expect(blocker.room_number).toBe("101");
    // Extend into the blocker's dates: must move to 102.
    const moved = await asUser(staff, async (db) => (await db.query("select public.modify_reservation($1, $2::date, $3::date, 2) as r", [r.id, d(100), d(105)])).rows[0].r, { commit: true });
    expect(moved).toMatchObject({ room_number: "102", nights: 5, total_price_cents: 50000 });
    const ev = await pool.query("select event_type from public.reservation_events where reservation_id = $1 order by id", [r.id]);
    expect(ev.rows.map((e) => e.event_type)).toEqual(["created", "modified"]);
    // Both Double rooms now busy on d(104)-d(105).
    const third = await staffBook(staff, hotel, doubleType, d(98), d(100), { email: "third@example.test" });
    await expect(
      asUser(staff, (db) => db.query("select public.modify_reservation($1, $2::date, $3::date, 2)", [third.id, d(103), d(105)])),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("enforces status transitions", async () => {
    const r = await staffBook(staff, hotel, suiteType, d(110), d(111), { email: "status@example.test" });
    const set = (status: string) => asUser(staff, (db) => db.query("select public.update_reservation_status($1, $2::public.reservation_status)", [r.id, status]), { commit: true });
    await expect(set("checked_out")).rejects.toMatchObject({ code: "55000" });
    await expect(set("checked_in")).rejects.toMatchObject({ code: "55000" }); // stay hasn't started
    await set("canceled");
    await expect(set("confirmed")).rejects.toMatchObject({ code: "55000" });
    const { rows } = await pool.query("select status, canceled_by from public.reservations where id = $1", [r.id]);
    expect(rows[0]).toEqual({ status: "canceled", canceled_by: staff });
  });

  it("outsiders cannot change or cancel reservations", async () => {
    const r = await staffBook(staff, hotel, suiteType, d(115), d(116), { email: "safe@example.test" });
    await expect(asUser(outsider, (db) => db.query("select public.cancel_reservation($1, 'x')", [r.id]))).rejects.toMatchObject({ code: "P0002" });
    await expect(asUser(outsider, (db) => db.query("select public.modify_reservation($1, $2::date, $3::date, 1)", [r.id, d(115), d(117)]))).rejects.toMatchObject({ code: "P0002" });
  });
});

// ---------------------------------------------------------------------------
// AI booking flow
// ---------------------------------------------------------------------------
async function aiTurn(businessId: string, conversationId: string | null, startedBy: string, message: string) {
  const agent = (await pool.query("select id from public.agents where business_id = $1 and agent_type = 'reservation_assistant'", [businessId])).rows[0].id;
  return asService(async (db) =>
    (await db.query("select public.begin_agent_turn($1, $2, 'website', $3, $4, $5) as r", [businessId, agent, conversationId, startedBy, message])).rows[0].r,
  );
}

function quote(businessId: string, conversationId: string, messageId: number, roomType: string, ci: string, co: string, guests = 2) {
  return asService(async (db) =>
    (await db.query("select public.create_reservation_quote_service($1, $2, $3, $4, $5::date, $6::date, $7) as q", [businessId, conversationId, messageId, roomType, ci, co, guests])).rows[0].q,
  );
}

function aiBook(businessId: string, conversationId: string, messageId: number, quoteId: string, dryRun = false, email = "ai.guest@example.test") {
  return asService(async (db) =>
    (
      await db.query("select public.create_reservation_service($1, $2, $3, $4, $5, null, 'ai_website', $6) as r", [
        businessId,
        conversationId,
        messageId,
        quoteId,
        JSON.stringify({ full_name: "Ben Guest", email }),
        dryRun,
      ])
    ).rows[0].r,
  );
}

describe("AI booking: quote, explicit confirmation, then booking", () => {
  it("refuses to book in the same turn the quote was given, books after the guest replies", async () => {
    const t1 = await aiTurn(hotel, null, owner, "Do you have a double for 2 nights?");
    const q = await quote(hotel, t1.conversation_id, t1.customer_message_id, suiteType, d(120), d(122));
    expect(q).toMatchObject({ available: true, nights: 2, total_price_cents: 40000, currency: "EUR" });

    expect(await aiBook(hotel, t1.conversation_id, t1.customer_message_id, q.quote_id)).toEqual({ ok: false, reason: "guest_has_not_confirmed_quote" });

    const t2 = await aiTurn(hotel, t1.conversation_id, owner, "Yes, please book it.");
    const booked = await aiBook(hotel, t1.conversation_id, t2.customer_message_id, q.quote_id);
    expect(booked).toMatchObject({ ok: true, dry_run: false, reservation: { status: "confirmed", total_price_cents: 40000, room_number: "201" } });
    expect(booked.reservation.confirmation_reference).toMatch(/^[0-9A-F]{10}$/);
    const saved = await pool.query("select source, conversation_id from public.reservations where id = $1", [booked.reservation.id]);
    expect(saved.rows[0]).toEqual({ source: "ai_website", conversation_id: t1.conversation_id });

    // Retrying the same booking does not create a second reservation.
    const retry = await aiBook(hotel, t1.conversation_id, t2.customer_message_id, q.quote_id);
    expect(retry).toMatchObject({ ok: true, duplicate: true, reservation: { id: booked.reservation.id } });
  });

  it("rejects quotes from other conversations, expired quotes and changed prices", async () => {
    const a = await aiTurn(hotel, null, owner, "Hi");
    const b = await aiTurn(hotel, null, owner, "Hello");
    const q = await quote(hotel, a.conversation_id, a.customer_message_id, doubleType, d(130), d(131));
    const bNext = await aiTurn(hotel, b.conversation_id, owner, "book it");
    expect(await aiBook(hotel, b.conversation_id, bNext.customer_message_id, q.quote_id)).toEqual({ ok: false, reason: "quote_not_found" });

    await asService((db) => db.query("update public.reservation_quotes set expires_at = now() - interval '1 second' where id = $1", [q.quote_id]));
    const aNext = await aiTurn(hotel, a.conversation_id, owner, "yes");
    expect(await aiBook(hotel, a.conversation_id, aNext.customer_message_id, q.quote_id)).toEqual({ ok: false, reason: "quote_expired" });

    const q2 = await quote(hotel, a.conversation_id, aNext.customer_message_id, doubleType, d(140), d(141));
    await asService((db) =>
      db.query("insert into public.room_type_rates (business_id, room_type_id, starts_on, ends_on, nightly_price_cents) values ($1, $2, $3::date, $4::date, 99999)", [hotel, doubleType, d(140), d(141)]),
    );
    const aLast = await aiTurn(hotel, a.conversation_id, owner, "confirm");
    expect(await aiBook(hotel, a.conversation_id, aLast.customer_message_id, q2.quote_id)).toMatchObject({ ok: false, reason: "price_changed", new_total_price_cents: 99999 });
  });

  it("dry runs (playground) validate everything but save nothing", async () => {
    const t1 = await aiTurn(hotel, null, owner, "suite please");
    const q = await quote(hotel, t1.conversation_id, t1.customer_message_id, suiteType, d(150), d(151));
    const t2 = await aiTurn(hotel, t1.conversation_id, owner, "yes");
    const r = await aiBook(hotel, t1.conversation_id, t2.customer_message_id, q.quote_id, true, "dry@example.test");
    expect(r).toMatchObject({ ok: true, dry_run: true, reservation: { id: null, room_number: "201" } });
    expect(r.reservation.confirmation_reference).toMatch(/^TEST-[0-9A-F]{10}$/);
    const counts = await pool.query("select (select count(*) from public.guests where email = 'dry@example.test')::int as g, (select count(*) from public.reservations where business_id = $1 and check_in = $2::date)::int as r", [hotel, d(150)]);
    expect(counts.rows[0]).toEqual({ g: 0, r: 0 });
    const avail = await asUser(staff, (db) => search(db, hotel, d(150), d(151), 2));
    expect(avail.rows.find((x) => x.name === "Suite").available_rooms).toBe(1);
  });

  it("reports sold-out instead of creating a quote", async () => {
    await staffBook(staff, hotel, suiteType, d(160), d(162), { email: "full@example.test" });
    const t = await aiTurn(hotel, null, owner, "suite?");
    expect(await quote(hotel, t.conversation_id, t.customer_message_id, suiteType, d(160), d(161))).toEqual({ available: false, reason: "sold_out" });
  });
});

describe("guest self-service via AI", () => {
  it("looks up a reservation only with the matching email", async () => {
    const r = await staffBook(staff, hotel, suiteType, d(170), d(171), { email: "lookup@example.test" });
    const get = (ref: string, email: string) =>
      asService(async (db) => (await db.query("select public.get_reservation_service($1, $2, $3) as r", [hotel, ref, email])).rows[0].r);
    expect(await get(r.confirmation_reference.toLowerCase(), "LOOKUP@example.test")).toMatchObject({ id: r.id, status: "confirmed" });
    expect(await get(r.confirmation_reference, "attacker@example.test")).toEqual({ found: false });
  });

  it("cancels only when the hotel allows it and the free window is open; otherwise hands over", async () => {
    const r = await staffBook(staff, hotel, suiteType, d(180), d(181), { email: "cancel@example.test" });
    const t = await aiTurn(hotel, null, owner, "please cancel");
    const cancel = () =>
      asService(async (db) =>
        (await db.query("select public.request_cancellation_service($1, $2, $3, 'cancel@example.test', 'Plans changed') as r", [hotel, t.conversation_id, r.confirmation_reference])).rows[0].r,
      );

    // Default: AI may not cancel -> handed to staff, conversation escalated.
    expect(await cancel()).toMatchObject({ ok: true, canceled: false, handed_to_staff: true });
    const conv = await pool.query("select status from public.agent_conversations where id = $1", [t.conversation_id]);
    expect(conv.rows[0].status).toBe("escalated");

    await asService((db) => db.query(`update public.business_settings set booking_settings = booking_settings || '{"ai_can_cancel": true, "free_cancellation_hours": 48}' where business_id = $1`, [hotel]));
    expect(await cancel()).toMatchObject({ ok: true, canceled: true, reservation: { status: "canceled" } });

    // Inside the 48h window -> staff.
    const soon = await staffBook(staff, hotel, suiteType, d(1), d(2), { email: "cancel@example.test" });
    const late = await asService(async (db) =>
      (await db.query("select public.request_cancellation_service($1, $2, $3, 'cancel@example.test', null) as r", [hotel, t.conversation_id, soon.confirmation_reference])).rows[0].r,
    );
    expect(late).toMatchObject({ canceled: false, handed_to_staff: true, outside_free_window: true });
  });
});

describe("server-only functions", () => {
  it("are not callable by signed-in users", async () => {
    for (const sql of [
      "select public.create_reservation_quote_service(gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), current_date, current_date + 1, 1)",
      "select public.create_reservation_service(gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), '{}', null, 'ai_website', false)",
      "select public.get_reservation_service(gen_random_uuid(), 'X', 'y')",
      "select public.request_cancellation_service(gen_random_uuid(), gen_random_uuid(), 'X', 'y', null)",
    ]) {
      await expect(asUser(owner, (db) => db.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("reservation history is readable by members only", async () => {
    const { rowCount } = await asUser(outsider, (db) => db.query("select * from public.reservation_events where business_id = $1", [hotel]));
    expect(rowCount).toBe(0);
  });
});
