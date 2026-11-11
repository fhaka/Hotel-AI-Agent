import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool } from "./helpers";

let owner: string;
let staff: string;
let admin: string;
let otherOwner: string;
let hotel: string;
let otherHotel: string;
let restaurant: string;

const hours = { mon: { mode: "hours", opens: "08:00", closes: "22:00" } };
const services = [
  { title: "Airport transfer", content: "€40 each way, book 24h ahead." },
  { title: "", content: "ignored because title is empty" },
];
const faqs = [{ question: "Is there a lift?", answer: "Yes, to all floors." }];

const roomTypes = [
  {
    name: "Double Room",
    description: "Sea view",
    maximum_guests: 2,
    bed_configuration: "1 queen bed",
    amenities: ["Air conditioning", "Balcony"],
    base_price_cents: 12000,
    room_numbers: ["101", "102"],
  },
  {
    name: "Family Suite",
    maximum_guests: 4,
    amenities: [],
    base_price_cents: 22000,
    room_numbers: ["201"],
  },
];

function saveOperations(userId: string, businessId: string, opts: { commit?: boolean } = {}) {
  return asUser(
    userId,
    (db) =>
      db.query("select public.save_onboarding_operations($1, $2, $3, $4, $5)", [
        businessId,
        JSON.stringify(hours),
        JSON.stringify({ general: "No smoking", contact_instructions: "Call reception" }),
        JSON.stringify(services),
        JSON.stringify(faqs),
      ]),
    opts,
  );
}

function saveHotel(userId: string, businessId: string, types = roomTypes, opts: { commit?: boolean } = {}) {
  return asUser(
    userId,
    (db) =>
      db.query("select public.save_onboarding_hotel($1, $2, $3, $4)", [
        businessId,
        JSON.stringify({ check_in_time: "14:00", check_out_time: "11:00", currency: "EUR" }),
        JSON.stringify({ breakfast: "7-10am, included", pets: "Small dogs welcome" }),
        JSON.stringify(types),
      ]),
    opts,
  );
}

beforeAll(async () => {
  owner = await createUser();
  staff = await createUser();
  admin = await createUser();
  otherOwner = await createUser();
  hotel = await createWorkspace(owner, "Onboarding Hotel");
  otherHotel = await createWorkspace(otherOwner, "Other Hotel");
  restaurant = await createWorkspace(otherOwner, "Some Restaurant", "restaurant");
  await addMember(hotel, staff, "staff");
  await addMember(hotel, admin, "admin");
});

afterAll(async () => {
  await pool.end();
});

describe("create_business_workspace (full profile)", () => {
  it("stores the optional company fields and marks the company step done", async () => {
    const user = await createUser();
    const id = await asUser(
      user,
      async (db) =>
        (
          await db.query(
            `select public.create_business_workspace(
               p_name => 'Profile Hotel', p_industry => 'hotel', p_timezone => 'Europe/Tirane',
               p_default_language => 'sq', p_supported_languages => array['sq','en'],
               p_country => 'AL', p_city => 'Tirana', p_contact_email => 'info@example.test',
               p_description => 'Boutique hotel', p_phone => '+355 4 000 0000',
               p_website => 'https://example.test', p_address => 'Rruga 1') as id`,
          )
        ).rows[0].id as string,
      { commit: true },
    );
    const { rows } = await pool.query("select * from public.businesses where id = $1", [id]);
    expect(rows[0]).toMatchObject({
      description: "Boutique hotel",
      phone: "+355 4 000 0000",
      website: "https://example.test",
      address: "Rruga 1",
      timezone: "Europe/Tirane",
      supported_languages: ["sq", "en"],
      onboarding_state: { completed_steps: ["company"] },
      onboarding_completed_at: null,
    });
  });
});

describe("save_onboarding_operations", () => {
  it("saves hours, merges policies and creates knowledge entries", async () => {
    await saveOperations(owner, hotel, { commit: true });
    const settings = await pool.query("select opening_hours, policies from public.business_settings where business_id = $1", [hotel]);
    expect(settings.rows[0].opening_hours).toEqual(hours);
    expect(settings.rows[0].policies).toMatchObject({ general: "No smoking" });
    const knowledge = await pool.query(
      "select category, title from public.agent_knowledge where business_id = $1 order by category",
      [hotel],
    );
    // Ordered by enum declaration order (faq before services); the entry with
    // an empty title was skipped.
    expect(knowledge.rows).toEqual([
      { category: "faq", title: "Is there a lift?" },
      { category: "services", title: "Airport transfer" },
    ]);
  });

  it("re-saving replaces onboarding entries but keeps manual knowledge", async () => {
    await asService((db) =>
      db.query(
        "insert into public.agent_knowledge (business_id, title, content, category, source_type) values ($1, 'Manual', 'kept', 'faq', 'manual')",
        [hotel],
      ),
    );
    await saveOperations(owner, hotel, { commit: true });
    const { rows } = await pool.query(
      "select source_type, count(*)::int as n from public.agent_knowledge where business_id = $1 group by source_type order by source_type",
      [hotel],
    );
    expect(rows).toEqual([
      { source_type: "manual", n: 1 },
      { source_type: "onboarding", n: 2 },
    ]);
  });

  it("staff cannot save onboarding steps", async () => {
    await expect(saveOperations(staff, hotel)).rejects.toMatchObject({ code: "42501" });
  });

  it("an admin can", async () => {
    await expect(saveOperations(admin, hotel)).resolves.toBeTruthy();
  });

  it("an owner cannot write into another business", async () => {
    await expect(saveOperations(owner, otherHotel)).rejects.toMatchObject({ code: "42501" });
    await expect(saveHotel(owner, otherHotel)).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(owner, (db) => db.query("select public.complete_onboarding($1)", [otherHotel])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("onboarding_state cannot be edited directly by clients", async () => {
    await expect(
      asUser(owner, (db) =>
        db.query(
          `update public.businesses set onboarding_state = '{"completed_steps":["operations","hotel"]}' where id = $1`,
          [hotel],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(owner, (db) => db.query("update public.businesses set onboarding_completed_at = now() where id = $1", [hotel])),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("save_onboarding_hotel", () => {
  it("creates room types and rooms", async () => {
    await saveHotel(owner, hotel, roomTypes, { commit: true });
    const { rows } = await pool.query(
      `select rt.name, rt.base_price_cents, rt.currency, rt.amenities, array_agg(r.room_number order by r.room_number) as rooms
       from public.room_types rt join public.rooms r on r.room_type_id = rt.id
       where rt.business_id = $1 group by rt.id order by rt.name`,
      [hotel],
    );
    expect(rows).toEqual([
      { name: "Double Room", base_price_cents: 12000, currency: "EUR", amenities: ["Air conditioning", "Balcony"], rooms: ["101", "102"] },
      { name: "Family Suite", base_price_cents: 22000, currency: "EUR", amenities: [], rooms: ["201"] },
    ]);
    const settings = await pool.query("select booking_settings, policies from public.business_settings where business_id = $1", [hotel]);
    expect(settings.rows[0].booking_settings).toMatchObject({ check_in_time: "14:00", currency: "EUR" });
    // Hotel policies merge with (not replace) the operations policies.
    expect(settings.rows[0].policies).toMatchObject({ general: "No smoking", breakfast: "7-10am, included" });
  });

  it("re-saving replaces the inventory instead of duplicating it", async () => {
    await saveHotel(owner, hotel, [roomTypes[0]], { commit: true });
    const { rows } = await pool.query("select count(*)::int as n from public.rooms where business_id = $1", [hotel]);
    expect(rows[0].n).toBe(2);
    await saveHotel(owner, hotel, roomTypes, { commit: true });
  });

  it("rejects duplicate room numbers and empty room types atomically", async () => {
    await expect(
      saveHotel(owner, hotel, [{ ...roomTypes[0], room_numbers: ["101", "101"] }]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(saveHotel(owner, hotel, [{ ...roomTypes[0], room_numbers: [] }])).rejects.toMatchObject({
      code: "22023",
    });
    // Failed saves leave the previous inventory intact.
    const { rows } = await pool.query("select count(*)::int as n from public.rooms where business_id = $1", [hotel]);
    expect(rows[0].n).toBe(3);
  });

  it("is rejected for non-hotel businesses", async () => {
    await expect(saveHotel(otherOwner, restaurant)).rejects.toMatchObject({ code: "22023" });
  });

  it("refuses to replace rooms once reservations exist", async () => {
    const user = await createUser();
    const b = await createWorkspace(user, "Busy Hotel");
    await saveHotel(user, b, roomTypes, { commit: true });
    await asService(async (db) => {
      const room = await db.query("select id from public.rooms where business_id = $1 limit 1", [b]);
      const guest = await db.query("insert into public.guests (business_id, full_name) values ($1, 'Guest') returning id", [b]);
      await db.query(
        `insert into public.reservations (business_id, room_id, guest_id, check_in, check_out, guests_count, total_price_cents)
         values ($1, $2, $3, '2027-01-01', '2027-01-02', 1, 100)`,
        [b, room.rows[0].id, guest.rows[0].id],
      );
    });
    await expect(saveHotel(user, b)).rejects.toMatchObject({ code: "55006" });
  });
});

describe("complete_onboarding", () => {
  it("requires the operations and (for hotels) hotel steps", async () => {
    const user = await createUser();
    const b = await createWorkspace(user, "Fresh Hotel");
    await expect(
      asUser(user, (db) => db.query("select public.complete_onboarding($1)", [b])),
    ).rejects.toMatchObject({ code: "55000" });
    await saveOperations(user, b, { commit: true });
    await expect(
      asUser(user, (db) => db.query("select public.complete_onboarding($1)", [b])),
    ).rejects.toMatchObject({ code: "55000" });
    await saveHotel(user, b, roomTypes, { commit: true });
    await asUser(user, (db) => db.query("select public.complete_onboarding($1)", [b]), { commit: true });
    const { rows } = await pool.query("select onboarding_completed_at, onboarding_state from public.businesses where id = $1", [b]);
    expect(rows[0].onboarding_completed_at).not.toBeNull();
    expect([...rows[0].onboarding_state.completed_steps].sort()).toEqual(["company", "hotel", "operations"]);
  });

  it("non-hotel businesses only need the operations step", async () => {
    await saveOperations(otherOwner, restaurant, { commit: true });
    await expect(
      asUser(otherOwner, (db) => db.query("select public.complete_onboarding($1)", [restaurant])),
    ).resolves.toBeTruthy();
  });
});
