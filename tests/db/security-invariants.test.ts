import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./helpers";

/**
 * Whole-schema security invariants. They catch the classic mistakes in new
 * migrations: a table without RLS, a function left executable by PUBLIC, or a
 * SECURITY DEFINER function without a fixed search_path.
 */
afterAll(async () => {
  await pool.end();
});

describe("schema security invariants", () => {
  it("every table in public has row level security enabled", async () => {
    const { rows } = await pool.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
    expect(rows).toEqual([]);
  });

  it("anonymous visitors can call only the intended public functions", async () => {
    const { rows } = await pool.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
        and p.prorettype <> 'trigger'::regtype
      order by 1`);
    expect(rows.map((r) => r.proname)).toEqual(["get_invitation_preview", "health_check", "widget_public_config"]);
  });

  it("anonymous visitors have no access to the private schema", async () => {
    const { rows } = await pool.query("select has_schema_privilege('anon', 'private', 'usage') as u");
    expect(rows[0].u).toBe(false);
  });

  it("every SECURITY DEFINER function pins its search_path", async () => {
    const { rows } = await pool.query(`
      select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      order by 1`);
    expect(rows).toEqual([]);
  });

  it("server-only functions are not callable by signed-in users", async () => {
    const serviceOnly = [
      "begin_agent_turn", "complete_agent_turn", "fail_agent_turn", "apply_billing_event", "claim_notifications",
      "complete_notification", "enqueue_due_notifications", "expire_trials", "purge_expired_conversations",
      "purge_operational_data", "record_voice_call", "assign_channel_address", "get_business_entitlements_service",
      "create_reservation_service", "consume_rate_limit",
    ];
    const { rows } = await pool.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1) and has_function_privilege('authenticated', p.oid, 'execute')`,
      [serviceOnly],
    );
    expect(rows).toEqual([]);
    const { rows: present } = await pool.query(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`,
      [serviceOnly],
    );
    expect(present.map((r) => r.proname).sort()).toEqual([...serviceOnly].sort());
  });

  it("nobody but the service role can write platform administrators, plans or settings", async () => {
    const { rows } = await pool.query(`
      select t, r, p from unnest(array['platform_admins', 'plans', 'platform_settings', 'subscriptions', 'audit_logs']) t,
        unnest(array['anon', 'authenticated']) r, unnest(array['INSERT', 'UPDATE', 'DELETE']) p
      where has_table_privilege(r, 'public.' || t, p)`);
    expect(rows).toEqual([]);
  });
});
