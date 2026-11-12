import { afterAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

async function makeAdmin() {
  const id = await createUser();
  await pool.query("insert into public.platform_admins (user_id) values ($1)", [id]);
  return id;
}

const call = <T = unknown>(userId: string, sql: string, params: unknown[] = []) =>
  asUser(userId, async (db) => (await db.query(sql, params)).rows[0]?.r as T, { commit: true });

const entitlements = async (businessId: string) =>
  (await asService(async (db) => (await db.query("select public.get_business_entitlements_service($1) as e", [businessId])).rows[0].e)) as {
    access_active: boolean;
    reason: string | null;
    limits: Record<string, number>;
    features: string[];
  };

describe("platform administration", () => {
  it("ordinary users and business owners are refused by every admin function", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Not Admin Hotel");
    expect(await call(owner, "select public.is_platform_admin() as r")).toBe(false);
    for (const [sql, params] of [
      ["select public.admin_overview() as r", []],
      ["select public.admin_list_businesses() as r", []],
      ["select public.admin_business_detail($1) as r", [b]],
      ["select public.admin_set_business_suspension($1, true, 'abuse') as r", [b]],
      ["select public.admin_set_limit_overrides($1, '{}') as r", [b]],
      ["select public.admin_assign_channel_address($1, 'voice', '+355690000555') as r", [b]],
      ["select public.admin_update_plan('basic', 'Basic', null, '{}', '[]', true) as r", []],
      ["select public.admin_get_settings() as r", []],
      ["select public.admin_update_setting('workspaces', '{\"max_created_per_user\": 99}') as r", []],
    ] as const) {
      await expect(call(owner, sql, [...params])).rejects.toMatchObject({ code: "42501" });
    }
    // Admin rights can't be self-granted.
    await expect(asUser(owner, (db) => db.query("insert into public.platform_admins (user_id) values ($1)", [owner]))).rejects.toMatchObject({ code: "42501" });
  });

  it("admins see platform totals and can search businesses", async () => {
    const admin = await makeAdmin();
    const owner = await createUser("findme-owner@example.test");
    const b = await createWorkspace(owner, "Searchable Seaside Hotel");
    const overview = await call<{ businesses: { total: number }; subscriptions: { trialing: number }; mrr_estimate: object }>(admin, "select public.admin_overview() as r");
    expect(overview.businesses.total).toBeGreaterThan(0);
    expect(overview.subscriptions.trialing).toBeGreaterThan(0);
    const byName = await call<{ total: number; rows: { id: string; owner_email: string }[] }>(admin, "select public.admin_list_businesses('seaside') as r");
    expect(byName.rows.map((r) => r.id)).toContain(b);
    const byEmail = await call<{ rows: { id: string; owner_email: string }[] }>(admin, "select public.admin_list_businesses('findme-owner') as r");
    expect(byEmail.rows).toEqual([expect.objectContaining({ id: b, owner_email: "findme-owner@example.test" })]);
    // LIKE wildcards in the search are literal.
    expect((await call<{ total: number }>(admin, "select public.admin_list_businesses('%') as r")).total).toBe(0);
    await expect(call(admin, "select public.admin_list_businesses(null, null, 500) as r")).rejects.toMatchObject({ code: "22023" });
    const detail = await call<{ business: { name: string }; members: { email: string; role: string }[] }>(admin, "select public.admin_business_detail($1) as r", [b]);
    expect(detail.business.name).toBe("Searchable Seaside Hotel");
    expect(detail.members).toEqual([{ email: "findme-owner@example.test", role: "owner", status: "active" }]);
  });

  it("suspension blocks access everywhere and is audited", async () => {
    const admin = await makeAdmin();
    const owner = await createUser();
    const b = await createWorkspace(owner, "Suspended Hotel");
    expect((await entitlements(b)).access_active).toBe(true);
    await expect(call(admin, "select public.admin_set_business_suspension($1, true, '') as r", [b])).rejects.toMatchObject({ code: "22023" });
    await call(admin, "select public.admin_set_business_suspension($1, true, 'Chargeback fraud') as r", [b]);
    expect(await entitlements(b)).toMatchObject({ access_active: false, reason: "suspended" });
    // Owners can't lift it themselves.
    await expect(asUser(owner, (db) => db.query("update public.businesses set suspended_at = null where id = $1", [b]))).rejects.toMatchObject({ code: "42501" });
    await call(admin, "select public.admin_set_business_suspension($1, false) as r", [b]);
    expect((await entitlements(b)).access_active).toBe(true);
    const log = await pool.query("select action, actor_id from public.audit_logs where business_id = $1 and action like 'admin.%' order by id", [b]);
    expect(log.rows).toEqual([
      { action: "admin.business_suspended", actor_id: admin },
      { action: "admin.business_unsuspended", actor_id: admin },
    ]);
  });

  it("limit overrides apply on top of the plan and are validated", async () => {
    const admin = await makeAdmin();
    const owner = await createUser();
    const b = await createWorkspace(owner, "Override Hotel");
    await call(admin, "select public.admin_set_limit_overrides($1, '{\"ai_messages_per_month\": 5000}') as r", [b]);
    const e = await entitlements(b);
    expect(e.limits.ai_messages_per_month).toBe(5000);
    expect(e.limits.members).toBe(3); // untouched trial limit
    for (const bad of ['{"ai_messages_per_month": -1}', '{"ai_messages_per_month": 1.5}', '{"unknown_limit": 1}', '{"members": "10"}', "[]"]) {
      await expect(call(admin, "select public.admin_set_limit_overrides($1, $2::jsonb) as r", [b, bad])).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("switching an agent type off platform-wide removes it from every plan", async () => {
    const admin = await makeAdmin();
    const owner = await createUser();
    const b = await createWorkspace(owner, "Availability Hotel");
    expect((await entitlements(b)).features).toContain("website_receptionist");
    try {
      await call(admin, `select public.admin_update_setting('agent_availability', '{"website_receptionist": false, "reservation_assistant": true, "voice_receptionist": true}') as r`);
      expect((await entitlements(b)).features).not.toContain("website_receptionist");
      await expect(call(admin, `select public.admin_update_setting('agent_availability', '{"website_receptionist": "no"}') as r`)).rejects.toMatchObject({ code: "22023" });
      await expect(call(admin, `select public.admin_update_setting('nonsense', '{}') as r`)).rejects.toMatchObject({ code: "22023" });
      await expect(call(admin, `select public.admin_update_setting('trial', '{"days": 365, "max_trials_per_user": 1, "plan_id": "growth", "usage_limits": {}}') as r`)).rejects.toMatchObject({ code: "22023" });
    } finally {
      await pool.query(`update public.platform_settings set value = '{"website_receptionist": true, "reservation_assistant": true, "voice_receptionist": true}' where key = 'agent_availability'`);
    }
  });

  it("admins assign and release phone numbers", async () => {
    const admin = await makeAdmin();
    const owner = await createUser();
    const b = await createWorkspace(owner, "Admin Number Hotel");
    await call(admin, "select public.admin_assign_channel_address($1, 'voice', '+355690000777') as r", [b]);
    expect((await pool.query("select address from public.business_channels where business_id = $1 and kind = 'voice'", [b])).rows[0].address).toBe("+355690000777");
    await call(admin, "select public.admin_release_channel_address($1, 'voice') as r", [b]);
    expect((await pool.query("select address, enabled from public.business_channels where business_id = $1 and kind = 'voice'", [b])).rows[0]).toEqual({ address: null, enabled: false });
  });

  it("plan edits are validated and can't change prices", async () => {
    const admin = await makeAdmin();
    const before = (await pool.query("select * from public.plans where id = 'basic'")).rows[0];
    try {
      await call(admin, "select public.admin_update_plan('basic', 'Basic', 'Small hotels', $1::jsonb, $2::jsonb, true) as r", [
        JSON.stringify({ ...before.usage_limits, ai_messages_per_month: 1234 }),
        JSON.stringify(before.features),
      ]);
      const after = (await pool.query("select * from public.plans where id = 'basic'")).rows[0];
      expect(after.usage_limits.ai_messages_per_month).toBe(1234);
      expect(after.monthly_price_cents).toBe(before.monthly_price_cents);
      await expect(call(admin, `select public.admin_update_plan('basic', 'Basic', null, '{}', '["Bad Feature!"]', true) as r`)).rejects.toMatchObject({ code: "22023" });
    } finally {
      await pool.query("update public.plans set usage_limits = $1, features = $2, description = $3 where id = 'basic'", [before.usage_limits, JSON.stringify(before.features), before.description]);
    }
  });
});

describe("privacy", () => {
  it("only owners can export; the export contains workspace data but no secrets", async () => {
    const owner = await createUser();
    const staff = await createUser();
    const outsider = await createUser();
    const b = await createWorkspace(owner, "Export Hotel");
    await addMember(b, staff, "staff");
    await pool.query("insert into public.guests (business_id, full_name, email) values ($1, 'Ana Guest', 'ana@example.test')", [b]);
    await expect(call(staff, "select public.export_business_data($1) as r", [b])).rejects.toMatchObject({ code: "42501" });
    await expect(call(outsider, "select public.export_business_data($1) as r", [b])).rejects.toMatchObject({ code: "42501" });
    const data = await call<Record<string, unknown>>(owner, "select public.export_business_data($1) as r", [b]);
    expect(data.format).toBe("hotelai-export-v1");
    expect(data.guests).toEqual([expect.objectContaining({ full_name: "Ana Guest", email: "ana@example.test" })]);
    expect(JSON.stringify(data)).not.toMatch(/provider_customer_id|public_key|external_ref/);
  });

  it("owners and admins can erase a guest's personal data", async () => {
    const owner = await createUser();
    const staff = await createUser();
    const b = await createWorkspace(owner, "Erase Hotel");
    await addMember(b, staff, "staff");
    const g = (await pool.query("insert into public.guests (business_id, full_name, email, phone, notes) values ($1, 'Ben Guest', 'ben@example.test', '+355691111111', 'VIP') returning id", [b])).rows[0].id;
    await expect(call(staff, "select public.erase_guest($1, $2) as r", [b, g])).rejects.toMatchObject({ code: "42501" });
    await call(owner, "select public.erase_guest($1, $2) as r", [b, g]);
    const row = (await pool.query("select full_name, email, phone, notes from public.guests where id = $1", [g])).rows[0];
    expect(row).toEqual({ full_name: "Erased guest", email: null, phone: null, notes: null });
  });

  it("workspace deletion: owner only, typed confirmation, no second free trial", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const b = await createWorkspace(owner, "Delete Me Hotel");
    await addMember(b, admin, "admin");
    await expect(call(admin, "select public.delete_business($1, 'Delete Me Hotel') as r", [b])).rejects.toMatchObject({ code: "42501" });
    await expect(call(owner, "select public.delete_business($1, 'wrong name') as r", [b])).rejects.toMatchObject({ code: "22023" });
    await call(owner, "select public.delete_business($1, 'Delete Me Hotel') as r", [b]);
    expect((await pool.query("select 1 from public.businesses where id = $1", [b])).rowCount).toBe(0);
    expect((await pool.query("select business_id from public.trial_grants where user_id = $1", [owner])).rows).toEqual([{ business_id: null }]);
    expect((await pool.query("select action from public.audit_logs where entity_id = $1 and action = 'business.deleted'", [b])).rowCount).toBe(1);
    // A new workspace by the same person gets no new trial.
    const again = await createWorkspace(owner, "Second Try Hotel");
    const sub = (await pool.query("select status from public.subscriptions where business_id = $1", [again])).rows[0];
    expect(sub?.status).not.toBe("trialing");
  });

  it("an active paid subscription must be canceled before deletion", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Paying Hotel");
    await asService((db) => db.query("update public.subscriptions set status = 'active', provider_subscription_id = $2, current_period_start = now(), current_period_end = now() + interval '30 days' where business_id = $1", [b, `sub_${b}`]));
    await expect(call(owner, "select public.delete_business($1, 'Paying Hotel') as r", [b])).rejects.toMatchObject({ code: "55000" });
  });
});

describe("retention", () => {
  it("purges old operational data but keeps the webhook idempotency ledger", async () => {
    await pool.query("insert into public.job_runs (job, started_at, finished_at, status) values ('scheduled', now() - interval '400 days', now() - interval '400 days', 'ok')");
    const wh = (await pool.query("insert into public.webhook_events (provider, provider_event_id, event_type, payload, processing_status, created_at) values ('paddle', $1, 'x', '{\"a\":1}', 'processed', now() - interval '200 days') returning id", [`evt_${Date.now()}`])).rows[0].id;
    await expect(asUser(await createUser(), (db) => db.query("select public.purge_operational_data()"))).rejects.toMatchObject({ code: "42501" });
    const r = await asService(async (db) => (await db.query("select public.purge_operational_data() as r")).rows[0].r);
    expect(r.job_runs).toBeGreaterThanOrEqual(1);
    expect((await pool.query("select payload from public.webhook_events where id = $1", [wh])).rows).toEqual([{ payload: null }]);
  });
});
