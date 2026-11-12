import { afterAll, expect, it } from "vitest";
import { asUser, createUser, createWorkspace, pool } from "./helpers";

/**
 * Regression test for a deadlock found by CI: concurrent bookings with
 * overlapping dates used to fail with 40P01 instead of a clean "sold out"
 * (23P01). Without the per-room-type allocation lock this test produced
 * deadlocks in every run; with it, none.
 */
const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

afterAll(async () => {
  await pool.end();
});

it("concurrent overlapping bookings either succeed or report sold out — never deadlock or double-book", async () => {
  const owner = await createUser();
  const b = await createWorkspace(owner, "Concurrency Hotel");
  await asUser(
    owner,
    (db) =>
      db.query("select public.save_onboarding_hotel($1, $2, $3, $4)", [
        b,
        JSON.stringify({ check_in_time: "14:00", check_out_time: "11:00", currency: "EUR" }),
        "{}",
        JSON.stringify([{ name: "Double", maximum_guests: 2, amenities: [], base_price_cents: 10000, room_numbers: ["101", "102"] }]),
      ]),
    { commit: true },
  );
  const type = (await pool.query("select id from public.room_types where business_id = $1", [b])).rows[0].id;

  const codes: Record<string, number> = {};
  for (let round = 0; round < 20; round++) {
    const base = 10 + round * 5;
    // Ranges [base, base+2], [base+1, base+3], [base+2, base+3] overlap pairwise.
    const ranges = [[0, 2], [1, 3], [2, 3]] as const;
    const results = await Promise.allSettled(
      Array.from({ length: 9 }, (_, i) => {
        const [from, to] = ranges[i % 3];
        return asUser(
          owner,
          (db) =>
            db.query("select public.create_reservation($1, $2, null, $3::date, $4::date, 2, $5, null, null)", [
              b,
              type,
              d(base + from),
              d(base + to),
              JSON.stringify({ full_name: "Guest", email: `g${round}-${i}@example.test` }),
            ]),
          { commit: true },
        );
      }),
    );
    for (const r of results) {
      const key = r.status === "fulfilled" ? "ok" : String((r.reason as { code?: string }).code);
      codes[key] = (codes[key] ?? 0) + 1;
    }
  }

  expect(Object.keys(codes).sort()).toEqual(["23P01", "ok"]);
  // No room is ever booked twice for the same night.
  const { rows } = await pool.query(
    `select count(*)::int as n from public.reservations a join public.reservations b2
       on a.room_id = b2.room_id and a.id < b2.id
      and daterange(a.check_in, a.check_out, '[)') && daterange(b2.check_in, b2.check_out, '[)')
     where a.business_id = $1 and a.status = 'confirmed' and b2.status = 'confirmed'`,
    [b],
  );
  expect(rows[0].n).toBe(0);
}, 120_000);
