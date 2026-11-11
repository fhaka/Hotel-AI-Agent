import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pgErrorCode, pool } from "./helpers";

/**
 * Multi-tenant isolation: Business A must never read or modify Business B.
 */
let ownerA: string;
let ownerB: string;
let staffA: string;
let outsider: string;
let businessA: string;
let businessB: string;

beforeAll(async () => {
  ownerA = await createUser("owner-a@example.test", "Owner A");
  ownerB = await createUser("owner-b@example.test", "Owner B");
  staffA = await createUser("staff-a@example.test", "Staff A");
  outsider = await createUser("outsider@example.test", "Outsider");
  businessA = await createWorkspace(ownerA, "Hotel Alpha");
  businessB = await createWorkspace(ownerB, "Hotel Bravo");
  await addMember(businessA, staffA, "staff");

  // Seed one knowledge entry per business (as service role).
  await asService(async (db) => {
    await db.query(
      `insert into public.agent_knowledge (business_id, title, content, category)
       values ($1, 'Breakfast', 'Alpha breakfast 7-10', 'hotel'), ($2, 'Breakfast', 'Bravo secret', 'hotel')`,
      [businessA, businessB],
    );
  });
});

afterAll(async () => {
  await pool.end();
});

describe("RLS coverage", () => {
  it("has RLS enabled on every table in the public schema", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("gives the anon role no access to tenant data", async () => {
    for (const table of ["businesses", "business_members", "subscriptions", "agents", "reservations", "guests"]) {
      await expect(asUser(null, (db) => db.query(`select * from public.${table}`)), table).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("lets anon read active plans for the public pricing page", async () => {
    const plans = await asUser(null, (db) => db.query("select id from public.plans order by sort_order"));
    expect(plans.rows.map((r) => r.id)).toEqual(["basic", "growth", "business"]);
  });
});

describe("tenant isolation", () => {
  it("owner A only sees business A", async () => {
    const { rows } = await asUser(ownerA, (db) => db.query("select id from public.businesses"));
    expect(rows.map((r) => r.id)).toEqual([businessA]);
  });

  it("owner A cannot read business B's knowledge, members, subscription or agents", async () => {
    await asUser(ownerA, async (db) => {
      for (const table of ["agent_knowledge", "business_members", "subscriptions", "agents", "business_settings"]) {
        const { rowCount } = await db.query(`select 1 from public.${table} where business_id = $1`, [businessB]);
        expect(rowCount, table).toBe(0);
      }
    });
  });

  it("owner A cannot update business B", async () => {
    const result = await asUser(ownerA, (db) =>
      db.query("update public.businesses set name = 'Hacked' where id = $1", [businessB]),
    );
    expect(result.rowCount).toBe(0);
    const { rows } = await pool.query("select name from public.businesses where id = $1", [businessB]);
    expect(rows[0].name).toBe("Hotel Bravo");
  });

  it("owner A cannot insert data into business B", async () => {
    await expect(
      asUser(ownerA, (db) =>
        db.query(
          "insert into public.agent_knowledge (business_id, title, content) values ($1, 'x', 'y')",
          [businessB],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("owner A cannot read business B's conversations", async () => {
    await asService(async (db) => {
      const agent = await db.query(
        "select id from public.agents where business_id = $1 and agent_type = 'website_receptionist'",
        [businessB],
      );
      const conv = await db.query(
        "insert into public.agent_conversations (business_id, agent_id, channel) values ($1, $2, 'playground') returning id",
        [businessB, agent.rows[0].id],
      );
      await db.query(
        "insert into public.agent_messages (business_id, conversation_id, sender_type, content) values ($1, $2, 'customer', 'private message')",
        [businessB, conv.rows[0].id],
      );
    });
    const res = await asUser(ownerA, async (db) => ({
      convs: (await db.query("select * from public.agent_conversations")).rowCount,
      msgs: (await db.query("select * from public.agent_messages")).rowCount,
    }));
    expect(res).toEqual({ convs: 0, msgs: 0 });
  });

  it("a user without membership sees nothing", async () => {
    const { rowCount } = await asUser(outsider, (db) => db.query("select * from public.businesses"));
    expect(rowCount).toBe(0);
  });

  it("an outsider cannot add themselves to a business", async () => {
    await expect(
      asUser(outsider, (db) =>
        db.query(
          "insert into public.business_members (business_id, user_id, role, invitation_status) values ($1, $2, 'owner', 'active')",
          [businessA, outsider],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot link a row to another tenant's parent row (composite FK)", async () => {
    const roomTypeB = await asUser(
      ownerB,
      async (db) =>
        (
          await db.query(
            "insert into public.room_types (business_id, name, maximum_guests, base_price_cents) values ($1, 'Double', 2, 10000) returning id",
            [businessB],
          )
        ).rows[0].id as string,
      { commit: true },
    );
    // Owner A tries to create a room in A pointing at B's room type.
    await expect(
      asUser(ownerA, (db) =>
        db.query("insert into public.rooms (business_id, room_type_id, room_number) values ($1, $2, '101')", [
          businessA,
          roomTypeB,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("a user in two workspaces sees both, each with the correct role", async () => {
    const multi = await createUser("multi@example.test");
    await addMember(businessA, multi, "manager");
    await addMember(businessB, multi, "staff");
    const { rows } = await asUser(multi, (db) =>
      db.query("select business_id, role from public.business_members where user_id = auth.uid() order by role"),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { business_id: businessA, role: "manager" },
        { business_id: businessB, role: "staff" },
      ]),
    );
    // Manager rights in A do not carry over to B, where they are only staff.
    const inB = await asUser(multi, (db) =>
      db.query("update public.business_settings set policies = '{\"x\":1}' where business_id = $1", [businessB]),
    );
    expect(inB.rowCount).toBe(0);
  });
});

describe("roles", () => {
  it("staff cannot update business details", async () => {
    const res = await asUser(staffA, (db) =>
      db.query("update public.businesses set name = 'Staff Rename' where id = $1", [businessA]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("staff cannot change member roles", async () => {
    await expect(
      asUser(staffA, (db) => db.query("select public.update_member_role($1, $2, 'owner')", [businessA, staffA])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("staff cannot edit the knowledge base but can read it", async () => {
    await asUser(staffA, async (db) => {
      const read = await db.query("select content from public.agent_knowledge where business_id = $1", [businessA]);
      expect(read.rows.map((r) => r.content)).toEqual(["Alpha breakfast 7-10"]);
      const upd = await db.query("update public.agent_knowledge set content = 'x' where business_id = $1", [
        businessA,
      ]);
      expect(upd.rowCount).toBe(0);
    });
  });

  it("owner can promote staff, and the change is audited", async () => {
    await asUser(ownerA, async (db) => {
      await db.query("select public.update_member_role($1, $2, 'manager')", [businessA, staffA]);
      const { rows } = await db.query(
        "select role from public.business_members where business_id = $1 and user_id = $2",
        [businessA, staffA],
      );
      expect(rows[0].role).toBe("manager");
      const audit = await db.query(
        "select action from public.audit_logs where business_id = $1 and action = 'member.role_changed'",
        [businessA],
      );
      expect(audit.rowCount).toBe(1);
    });
  });

  it("the last owner cannot demote or remove themselves", async () => {
    await expect(
      asUser(ownerA, (db) => db.query("select public.update_member_role($1, $2, 'admin')", [businessA, ownerA])),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      asUser(ownerA, (db) => db.query("select public.remove_business_member($1, $2)", [businessA, ownerA])),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("an admin cannot promote anyone to owner", async () => {
    const admin = await createUser();
    const target = await createUser();
    await addMember(businessA, admin, "admin");
    await addMember(businessA, target, "staff");
    let code: string | undefined;
    try {
      await asUser(admin, (db) => db.query("select public.update_member_role($1, $2, 'owner')", [businessA, target]));
    } catch (e) {
      code = pgErrorCode(e);
    }
    expect(code).toBe("42501");
  });

  it("users cannot grant themselves platform admin", async () => {
    await expect(
      asUser(ownerA, (db) => db.query("insert into public.platform_admins (user_id) values (auth.uid())")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("audit logs cannot be modified", async () => {
    await expect(
      asService((db) => db.query("update public.audit_logs set action = 'tampered'")),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
