import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, createUser, createWorkspace, pool } from "./helpers";

let owner: string;
let staff: string;
let businessId: string;
let roomId: string;
let guestId: string;

beforeAll(async () => {
  owner = await createUser();
  staff = await createUser();
  businessId = await createWorkspace(owner, "Booking Hotel");
  await addMember(businessId, staff, "staff");
  await asUser(
    owner,
    async (db) => {
      const rt = await db.query(
        "insert into public.room_types (business_id, name, maximum_guests, base_price_cents) values ($1, 'Double', 2, 12000) returning id",
        [businessId],
      );
      const room = await db.query(
        "insert into public.rooms (business_id, room_type_id, room_number) values ($1, $2, '101') returning id",
        [businessId, rt.rows[0].id],
      );
      const guest = await db.query(
        "insert into public.guests (business_id, full_name, email) values ($1, 'Ada Guest', 'ada@example.test') returning id",
        [businessId],
      );
      roomId = room.rows[0].id;
      guestId = guest.rows[0].id;
    },
    { commit: true },
  );
});

afterAll(async () => {
  await pool.end();
});

function book(userId: string, checkIn: string, checkOut: string, opts: { commit?: boolean } = {}) {
  return asUser(
    userId,
    (db) =>
      db.query(
        `insert into public.reservations
           (business_id, room_id, guest_id, check_in, check_out, guests_count, total_price_cents, status, created_by)
         values ($1, $2, $3, $4, $5, 2, 24000, 'confirmed', auth.uid()) returning id, confirmation_reference`,
        [businessId, roomId, guestId, checkIn, checkOut],
      ),
    opts,
  );
}

describe("reservations", () => {
  it("staff can create a valid booking", async () => {
    const res = await book(staff, "2027-03-01", "2027-03-03");
    expect(res.rows[0].confirmation_reference).toMatch(/^[0-9A-F]{10}$/);
  });

  it("rejects check-out on or before check-in", async () => {
    await expect(book(staff, "2027-03-05", "2027-03-05")).rejects.toMatchObject({ code: "23514" });
    await expect(book(staff, "2027-03-05", "2027-03-04")).rejects.toMatchObject({ code: "23514" });
  });

  it("prevents double-booking the same room for overlapping dates", async () => {
    await book(owner, "2027-04-10", "2027-04-14", { commit: true });
    await expect(book(staff, "2027-04-12", "2027-04-15")).rejects.toMatchObject({ code: "23P01" });
    await expect(book(staff, "2027-04-09", "2027-04-11")).rejects.toMatchObject({ code: "23P01" });
  });

  it("allows back-to-back stays (check-out day = next check-in day)", async () => {
    await book(owner, "2027-05-01", "2027-05-03", { commit: true });
    await expect(book(owner, "2027-05-03", "2027-05-05")).resolves.toBeTruthy();
  });

  it("frees the room once a reservation is canceled", async () => {
    const res = await book(owner, "2027-06-01", "2027-06-04", { commit: true });
    await asUser(
      owner,
      (db) =>
        db.query("update public.reservations set status = 'canceled', canceled_at = now() where id = $1", [
          res.rows[0].id,
        ]),
      { commit: true },
    );
    await expect(book(staff, "2027-06-02", "2027-06-03")).resolves.toBeTruthy();
  });

  it("concurrent bookings for the same room and dates produce exactly one reservation", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => book(staff, "2027-07-10", "2027-07-12", { commit: true })),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const failed = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed.every((f) => f.reason?.code === "23P01")).toBe(true);
    const { rows } = await pool.query(
      "select count(*)::int as n from public.reservations where room_id = $1 and check_in = '2027-07-10' and status <> 'canceled'",
      [roomId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("members cannot hard-delete reservations", async () => {
    await expect(
      asUser(owner, (db) => db.query("delete from public.reservations where business_id = $1", [businessId])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a reservation cannot be attributed to another user", async () => {
    await expect(
      asUser(staff, (db) =>
        db.query(
          `insert into public.reservations (business_id, room_id, guest_id, check_in, check_out, guests_count, total_price_cents, created_by)
           values ($1, $2, $3, '2027-08-01', '2027-08-02', 1, 100, $4)`,
          [businessId, roomId, guestId, owner],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
