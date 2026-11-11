import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool, type Db } from "./helpers";

let owner: string;
let manager: string;
let staff: string;
let otherOwner: string;
let hotel: string;
let other: string;

function insert(db: Db, businessId: string, title: string, content: string, category = "faq", source = "manual") {
  return db.query(
    "insert into public.agent_knowledge (business_id, title, content, category, source_type) values ($1, $2, $3, $4::public.knowledge_category, $5) returning id, source_type, created_by",
    [businessId, title, content, category, source],
  );
}

function search(db: Db, businessId: string, query: string | null, category: string | null = null, limit = 20, offset = 0) {
  return db.query("select * from public.search_agent_knowledge($1, $2, $3::public.knowledge_category, $4, $5)", [
    businessId,
    query,
    category,
    limit,
    offset,
  ]);
}

beforeAll(async () => {
  owner = await createUser();
  manager = await createUser();
  staff = await createUser();
  otherOwner = await createUser();
  hotel = await createWorkspace(owner, "Knowledge Hotel");
  other = await createWorkspace(otherOwner, "Other Hotel");
  await addMember(hotel, manager, "manager");
  await addMember(hotel, staff, "staff");
  await asUser(
    owner,
    async (db) => {
      await insert(db, hotel, "Breakfast hours", "Breakfast is served 7:00–10:30 in the garden.");
      await insert(db, hotel, "Airport transfer", "We arrange taxis for €40 (100% prepaid_).", "services");
      await insert(db, hotel, "Late check-out", "Until 14:00 for €20.", "policies");
    },
    { commit: true },
  );
  await asUser(otherOwner, (db) => insert(db, other, "Secret breakfast", "Other hotel only"), { commit: true });
});

afterAll(async () => {
  await pool.end();
});

describe("knowledge CRUD permissions", () => {
  it("managers can create, edit and delete; staff can only read", async () => {
    await asUser(manager, async (db) => {
      const { rows } = await insert(db, hotel, "Gym", "Open 24h");
      await db.query("update public.agent_knowledge set content = 'Open 6-22' where id = $1", [rows[0].id]);
      const del = await db.query("delete from public.agent_knowledge where id = $1", [rows[0].id]);
      expect(del.rowCount).toBe(1);
    });
    await expect(asUser(staff, (db) => insert(db, hotel, "x", "y"))).rejects.toMatchObject({ code: "42501" });
    const res = await asUser(staff, (db) => db.query("update public.agent_knowledge set content = 'x' where business_id = $1", [hotel]));
    expect(res.rowCount).toBe(0);
    const read = await asUser(staff, (db) => search(db, hotel, null));
    expect(read.rowCount).toBe(3);
  });

  it("clients cannot spoof the author or the source of an entry", async () => {
    await asUser(manager, async (db) => {
      const { rows } = await insert(db, hotel, "Spoof", "content", "faq", "onboarding");
      expect(rows[0]).toMatchObject({ source_type: "manual", created_by: manager });
      await expect(
        db.query("update public.agent_knowledge set source_type = 'onboarding' where id = $1", [rows[0].id]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("knowledge changes are audited without content", async () => {
    await asUser(
      owner,
      async (db) => {
        const { rows } = await insert(db, hotel, "Audit me", "secret wifi password 1234");
        await db.query("update public.agent_knowledge set content = 'changed' where id = $1", [rows[0].id]);
        await db.query("delete from public.agent_knowledge where id = $1", [rows[0].id]);
      },
      { commit: true },
    );
    const { rows } = await pool.query(
      "select action, metadata from public.audit_logs where business_id = $1 and action like 'knowledge.%' order by id desc limit 3",
      [hotel],
    );
    expect(rows.map((r) => r.action)).toEqual(["knowledge.delete", "knowledge.update", "knowledge.insert"]);
    expect(rows[1].metadata).toEqual({ category: "faq", changed: ["content"] });
    expect(JSON.stringify(rows)).not.toContain("1234");
  });
});

describe("search_agent_knowledge", () => {
  it("finds case-insensitively in title or content, filtered by category", async () => {
    const r = await asUser(staff, (db) => search(db, hotel, "BREAKFAST"));
    expect(r.rows.map((x) => x.title)).toEqual(["Breakfast hours"]);
    const byContent = await asUser(staff, (db) => search(db, hotel, "taxis"));
    expect(byContent.rows.map((x) => x.title)).toEqual(["Airport transfer"]);
    const cat = await asUser(staff, (db) => search(db, hotel, null, "policies"));
    expect(cat.rows.map((x) => x.title)).toEqual(["Late check-out"]);
  });

  it("treats % and _ literally and is not injectable", async () => {
    expect((await asUser(staff, (db) => search(db, hotel, "%"))).rows.map((x) => x.title)).toEqual(["Airport transfer"]);
    expect((await asUser(staff, (db) => search(db, hotel, "prepaid_"))).rowCount).toBe(1);
    expect((await asUser(staff, (db) => search(db, hotel, "_"))).rowCount).toBe(1);
    expect((await asUser(staff, (db) => search(db, hotel, "') or true --"))).rowCount).toBe(0);
  });

  it("paginates with a total count and clamps the page size", async () => {
    const page = await asUser(staff, (db) => search(db, hotel, null, null, 2, 0));
    expect(page.rowCount).toBe(2);
    expect(Number(page.rows[0].total_count)).toBe(3);
    const big = await asUser(staff, (db) => search(db, hotel, null, null, 10_000, 0));
    expect(big.rowCount).toBe(3);
  });

  it("never returns another tenant's knowledge, even when asked for it by id", async () => {
    const r = await asUser(owner, (db) => search(db, other, "breakfast"));
    expect(r.rowCount).toBe(0);
    const outsider = await createUser();
    expect((await asUser(outsider, (db) => search(db, hotel, null))).rowCount).toBe(0);
  });
});

describe("knowledge limits", () => {
  it("enforces the per-business entry limit", async () => {
    const user = await createUser();
    const b = await createWorkspace(user, "Limit Hotel");
    await asService(async (db) => {
      await db.query("update public.platform_settings set value = jsonb_set(value, '{max_entries}', '2') where key = 'knowledge'");
    });
    try {
      await asUser(user, async (db) => {
        await insert(db, b, "one", "1");
        await insert(db, b, "two", "2");
        await expect(insert(db, b, "three", "3")).rejects.toMatchObject({ code: "54000" });
      });
    } finally {
      await asService((db) =>
        db.query("update public.platform_settings set value = jsonb_set(value, '{max_entries}', '500') where key = 'knowledge'"),
      );
    }
  });

  it("enforces the total size limit on insert and update", async () => {
    const user = await createUser();
    const b = await createWorkspace(user, "Size Hotel");
    await asService((db) =>
      db.query("update public.platform_settings set value = jsonb_set(value, '{max_total_chars}', '100') where key = 'knowledge'"),
    );
    try {
      await asUser(user, async (db) => {
        const { rows } = await insert(db, b, "t", "x".repeat(50));
        await db.query("savepoint s");
        await expect(insert(db, b, "t2", "x".repeat(60))).rejects.toMatchObject({ code: "54000" });
        await db.query("rollback to savepoint s");
        await expect(
          db.query("update public.agent_knowledge set content = $2 where id = $1", [rows[0].id, "y".repeat(120)]),
        ).rejects.toMatchObject({ code: "54000" });
      });
    } finally {
      await asService((db) =>
        db.query("update public.platform_settings set value = jsonb_set(value, '{max_total_chars}', '300000') where key = 'knowledge'"),
      );
    }
  });
});

describe("agent knowledge context from real data", () => {
  async function loadAs(userId: string, businessId: string) {
    const { formatKnowledgeContext } = await import("@/lib/knowledge/context");
    return asUser(userId, async (db) => {
      // Same tables/columns/filters as src/lib/knowledge/load.ts, read through RLS.
      const business = (await db.query(
        "select name, industry, description, contact_email, phone, website, address, city, country, timezone, default_language, supported_languages from public.businesses where id = $1",
        [businessId],
      )).rows[0];
      if (!business) return null;
      const settings = (await db.query("select opening_hours, policies, booking_settings from public.business_settings where business_id = $1", [businessId])).rows[0] ?? null;
      const roomTypes = (await db.query(
        "select name, description, maximum_guests, bed_configuration, amenities, base_price_cents, currency, is_active from public.room_types where business_id = $1",
        [businessId],
      )).rows;
      const entries = (await db.query("select id, title, content, category from public.agent_knowledge where business_id = $1", [businessId])).rows;
      return formatKnowledgeContext({ business, settings, roomTypes, entries });
    });
  }

  it("builds the context from the business's own data", async () => {
    const ctx = await loadAs(staff, hotel);
    expect(ctx?.text).toContain("Name: Knowledge Hotel");
    expect(ctx?.text).toContain("Breakfast is served 7:00–10:30");
    expect(ctx?.text).not.toContain("Other hotel only");
  });

  it("a member of business A gets nothing for business B", async () => {
    expect(await loadAs(owner, other)).toBeNull();
  });
});
