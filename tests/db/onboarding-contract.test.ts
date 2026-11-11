import { afterAll, describe, expect, it } from "vitest";
import { createWorkspaceArgs, hotelArgs, operationsArgs } from "@/lib/onboarding/rpc-args";
import {
  companyFromFormData,
  companySchema,
  hotelFromFormData,
  hotelSchema,
  operationsFromFormData,
  operationsSchema,
} from "@/lib/onboarding/schemas";
import { asUser, createUser, pool, type Db } from "./helpers";

/**
 * Contract test for the onboarding wizard: real FormData -> the same Zod
 * schemas and argument builders the Server Actions use -> the real SQL
 * functions, called with named arguments the way PostgREST calls them.
 * This catches mismatches between the UI layer and the database layer.
 */

afterAll(async () => {
  await pool.end();
});

// Parameters declared as Postgres text[]; every other object/array is jsonb.
const TEXT_ARRAY_PARAMS = new Set(["p_supported_languages"]);

async function rpc(db: Db, fn: string, args: Record<string, unknown>) {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined);
  const placeholders = entries.map(([k], i) => `${k} => $${i + 1}`).join(", ");
  const values = entries.map(([k, v]) =>
    v !== null && typeof v === "object" && !TEXT_ARRAY_PARAMS.has(k) ? JSON.stringify(v) : v,
  );
  const { rows } = await db.query(`select public.${fn}(${placeholders}) as result`, values);
  return rows[0].result;
}

function form(entries: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of [v].flat()) fd.append(k, item);
  return fd;
}

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

describe("onboarding wizard contract (form -> schema -> SQL)", () => {
  it("completes the full hotel onboarding as a real owner would", async () => {
    const user = await createUser();

    const company = companySchema.parse(
      companyFromFormData(
        form({
          name: "Hotel Adriatik",
          industry: "hotel",
          description: "Family-run beach hotel",
          contactEmail: "info@adriatik.example",
          phone: "+355 52 000 000",
          website: "adriatik.example",
          country: "AL",
          city: "Durrës",
          address: "Rruga e Plazhit 1",
          timezone: "Europe/Tirane",
          defaultLanguage: "sq",
          supportedLanguages: ["en", "it"],
        }),
      ),
    );
    const businessId: string = await asUser(user, (db) => rpc(db, "create_business_workspace", createWorkspaceArgs(company)), {
      commit: true,
    });

    const operations = operationsSchema.parse(
      operationsFromFormData(
        form({
          ...Object.fromEntries(days.flatMap((d) => [[`hours_${d}_mode`, "open_24h"], [`hours_${d}_opens`, "08:00"], [`hours_${d}_closes`, "20:00"]])),
          policyGeneral: "Quiet hours 23:00–07:00",
          contactInstructions: "Call reception for urgent requests",
          service_title: ["Airport transfer", ""],
          service_content: ["€40 from Tirana airport", ""],
          faq_question: ["Is the beach private?"],
          faq_answer: ["Sun loungers are free for guests."],
        }),
      ),
    );
    await asUser(user, (db) => rpc(db, "save_onboarding_operations", operationsArgs(businessId, operations)), { commit: true });

    const hotel = hotelSchema.parse(
      hotelFromFormData(
        form({
          checkInTime: "14:00",
          checkOutTime: "11:00",
          currency: "EUR",
          cancellation: "Free until 3 days before arrival",
          breakfast: "Included, 7:00–10:00",
          parking: "Free on site",
          wifi: "Free throughout",
          pets: "Not allowed",
          extraServices: "Boat trips",
          room_name: ["Double Sea View", "Family Room"],
          room_description: ["Balcony facing the sea", ""],
          room_max_guests: ["2", "4"],
          room_beds: ["1 double", "1 double + 2 single"],
          room_amenities: ["Air conditioning, Balcony", "Air conditioning"],
          room_price: ["95,00", "140"],
          room_numbers: ["101-104", "201, 202"],
        }),
      ),
    );
    await asUser(user, (db) => rpc(db, "save_onboarding_hotel", hotelArgs(businessId, hotel)), { commit: true });
    await asUser(user, (db) => rpc(db, "complete_onboarding", { p_business_id: businessId }), { commit: true });

    // Verify what an owner would now see, through RLS.
    const result = await asUser(user, async (db) => ({
      business: (await db.query("select name, website, timezone, supported_languages, onboarding_completed_at from public.businesses where id = $1", [businessId])).rows[0],
      sub: (await db.query("select status from public.subscriptions where business_id = $1", [businessId])).rows[0],
      rooms: (
        await db.query(
          `select rt.name, rt.base_price_cents, count(r.id)::int as rooms from public.room_types rt
           join public.rooms r on r.room_type_id = rt.id where rt.business_id = $1 group by rt.id order by rt.name`,
          [businessId],
        )
      ).rows,
      knowledge: (await db.query("select category, title from public.agent_knowledge where business_id = $1 order by category", [businessId])).rows,
      settings: (await db.query("select opening_hours -> 'mon' as mon, policies, booking_settings from public.business_settings where business_id = $1", [businessId])).rows[0],
    }));

    expect(result.business).toMatchObject({
      name: "Hotel Adriatik",
      website: "https://adriatik.example",
      timezone: "Europe/Tirane",
      supported_languages: ["sq", "en", "it"],
    });
    expect(result.business.onboarding_completed_at).not.toBeNull();
    expect(result.sub.status).toBe("trialing");
    expect(result.rooms).toEqual([
      { name: "Double Sea View", base_price_cents: 9500, rooms: 4 },
      { name: "Family Room", base_price_cents: 14000, rooms: 2 },
    ]);
    expect(result.knowledge).toEqual([
      { category: "faq", title: "Is the beach private?" },
      { category: "services", title: "Airport transfer" },
    ]);
    expect(result.settings.mon).toEqual({ mode: "open_24h" });
    expect(result.settings.policies).toMatchObject({
      general: "Quiet hours 23:00–07:00",
      cancellation: "Free until 3 days before arrival",
      contact_instructions: "Call reception for urgent requests",
    });
    expect(result.settings.booking_settings).toEqual({ check_in_time: "14:00", check_out_time: "11:00", currency: "EUR" });
  });

  it("a non-hotel business finishes after the operations step", async () => {
    const user = await createUser();
    const company = companySchema.parse(
      companyFromFormData(
        form({ name: "Salon Bella", industry: "beauty_salon", country: "IT", timezone: "Europe/Rome", defaultLanguage: "it" }),
      ),
    );
    const id: string = await asUser(user, (db) => rpc(db, "create_business_workspace", createWorkspaceArgs(company)), { commit: true });
    const ops = operationsSchema.parse(
      operationsFromFormData(form(Object.fromEntries(days.flatMap((d) => [[`hours_${d}_mode`, "closed"], [`hours_${d}_opens`, ""], [`hours_${d}_closes`, ""]])))),
    );
    await asUser(user, (db) => rpc(db, "save_onboarding_operations", operationsArgs(id, ops)), { commit: true });
    await expect(
      asUser(user, (db) => rpc(db, "complete_onboarding", { p_business_id: id }), { commit: true }),
    ).resolves.not.toThrow();
  });
});
