import { afterAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const configure = (userId: string, businessId: string, kind: string, enabled: boolean, config: object = {}) =>
  asUser(
    userId,
    async (db) => (await db.query("select * from public.configure_channel($1, $2::public.channel_kind, $3, $4)", [businessId, kind, enabled, JSON.stringify(config)])).rows[0],
    { commit: true },
  );

const assign = (businessId: string, kind: string, address: string) =>
  asService(async (db) => (await db.query("select * from public.assign_channel_address($1, $2::public.channel_kind, $3)", [businessId, kind, address])).rows[0]);

const widgetConfig = (key: string) => asUser(null, async (db) => (await db.query("select public.widget_public_config($1) as c", [key])).rows[0].c);

async function agentId(businessId: string, type: string) {
  return (await pool.query("select id from public.agents where business_id = $1 and agent_type = $2", [businessId, type])).rows[0].id as string;
}

function begin(businessId: string, agent: string, channel: string, conversationId: string | null, externalRef: string | null, message = "Hello") {
  return asService(async (db) =>
    (await db.query("select public.begin_agent_turn($1, $2, $3::public.conversation_channel, $4, null, $5, $6) as r", [businessId, agent, channel, conversationId, message, externalRef])).rows[0].r,
  );
}

describe("website widget", () => {
  it("owners create a widget with a public key; config is public only while enabled", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Widget Hotel");
    const row = await configure(owner, b, "website_widget", true, { allowed_origins: ["https://widget-hotel.example"] });
    expect(row.public_key).toMatch(/^wk_[0-9a-f]{32}$/);
    expect(await widgetConfig(row.public_key)).toEqual({
      enabled: true,
      business_name: "Widget Hotel",
      agent_name: "Website Receptionist",
      greeting: null,
      allowed_origins: ["https://widget-hotel.example"],
      accent_color: null,
      default_language: "en",
    });
    await configure(owner, b, "website_widget", false, {});
    expect(await widgetConfig(row.public_key)).toEqual({ enabled: false });
    expect(await widgetConfig("wk_" + "0".repeat(32))).toEqual({ enabled: false });
  });

  it("staff and outsiders can't configure or see channels; regenerating invalidates the old key", async () => {
    const owner = await createUser();
    const staff = await createUser();
    const outsider = await createUser();
    const b = await createWorkspace(owner, "Key Hotel");
    await addMember(b, staff, "staff");
    await expect(configure(staff, b, "website_widget", true)).rejects.toMatchObject({ code: "42501" });
    await expect(configure(outsider, b, "website_widget", true)).rejects.toMatchObject({ code: "42501" });
    const row = await configure(owner, b, "website_widget", true);
    expect((await asUser(outsider, (db) => db.query("select * from public.business_channels where business_id = $1", [b]))).rowCount).toBe(0);
    const newKey = await asUser(owner, async (db) => (await db.query("select public.regenerate_widget_key($1) as k", [b])).rows[0].k, { commit: true });
    expect(newKey).not.toBe(row.public_key);
    expect(await widgetConfig(row.public_key)).toEqual({ enabled: false });
    expect((await widgetConfig(newKey)).enabled).toBe(true);
  });
});

describe("phone numbers", () => {
  it("only the operator can assign numbers; owners can't claim one", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Phone Hotel");
    await expect(configure(owner, b, "voice", true)).rejects.toMatchObject({ code: "55000" });
    await expect(
      asUser(owner, (db) => db.query("select public.assign_channel_address($1, 'voice', '+355690000001')", [b])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(owner, (db) => db.query("insert into public.business_channels (business_id, kind, address) values ($1, 'voice', '+355690000001')", [b])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a number belongs to one business; assignment activates the voice agent for configuration", async () => {
    const o1 = await createUser();
    const o2 = await createUser();
    const b1 = await createWorkspace(o1, "Num One");
    const b2 = await createWorkspace(o2, "Num Two");
    await assign(b1, "voice", "+355690000002");
    await expect(assign(b2, "voice", "+355690000002")).rejects.toMatchObject({ code: "23505" });
    await expect(assign(b2, "voice", "0690000002")).rejects.toMatchObject({ code: "23514" });
    const { rows } = await pool.query("select status from public.agents where business_id = $1 and agent_type = 'voice_receptionist'", [b1]);
    expect(rows[0].status).toBe("draft");
    const row = await configure(o1, b1, "voice", true, { language: "en-GB", handoff_phone: "+355690000099" });
    expect(row).toMatchObject({ enabled: true, address: "+355690000002" });
  });
});

describe("conversation binding on public channels", () => {
  it("only the holder of the external reference can continue a conversation", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Bind Hotel");
    const a = await agentId(b, "website_receptionist");
    const first = await begin(b, a, "website", null, "visitor-hash-A");
    expect(first.allowed).toBe(true);
    expect(await begin(b, a, "website", first.conversation_id, "visitor-hash-B")).toEqual({ allowed: false, reason: "conversation_not_found" });
    expect(await begin(b, a, "website", first.conversation_id, null)).toEqual({ allowed: false, reason: "conversation_not_found" });
    expect((await begin(b, a, "website", first.conversation_id, "visitor-hash-A")).allowed).toBe(true);
    const { rows } = await pool.query("select external_ref, channel from public.agent_conversations where id = $1", [first.conversation_id]);
    expect(rows[0]).toEqual({ external_ref: "visitor-hash-A", channel: "website" });
  });

  it("voice calls stop when the plan's voice minutes are used up", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Voice Hotel");
    await asService((db) => db.query("update public.subscriptions set status = 'active', plan_id = 'business', current_period_start = now() - interval '1 day', current_period_end = now() + interval '29 days' where business_id = $1", [b]));
    await assign(b, "voice", "+355690000003");
    const voice = await agentId(b, "voice_receptionist");
    await asService((db) => db.query("update public.agents set enabled = true where id = $1", [voice]));
    expect((await begin(b, voice, "voice", null, "CA1")).allowed).toBe(true);
    await asService((db) => db.query("insert into public.usage_events (business_id, agent_id, event_type, quantity, unit) values ($1, $2, 'voice_minutes', 300, 'minute')", [b, voice]));
    expect(await begin(b, voice, "voice", null, "CA2")).toEqual({ allowed: false, reason: "usage_limit_reached" });
  });
});

describe("record_voice_call", () => {
  it("records minutes once per call, closes the conversation and queues one summary per staff recipient", async () => {
    const owner = await createUser("call-owner@example.test");
    const b = await createWorkspace(owner, "Call Hotel");
    await asService((db) => db.query("update public.subscriptions set status = 'active', plan_id = 'business', current_period_start = now() - interval '1 day', current_period_end = now() + interval '29 days' where business_id = $1", [b]));
    await assign(b, "voice", "+355690000004");
    const voice = await agentId(b, "voice_receptionist");
    await asService((db) => db.query("update public.agents set enabled = true where id = $1", [voice]));
    const turn = await begin(b, voice, "voice", null, "CAcall1", "I'd like to book a room");
    const record = () =>
      asService(async (db) => (await db.query("select public.record_voice_call($1, $2, $3, 'CAcall1', 61) as r", [b, turn.conversation_id, voice])).rows[0].r);
    expect(await record()).toEqual({ recorded: true, minutes: 2 });
    expect(await record()).toEqual({ recorded: false, duplicate: true });
    const ent = await asUser(owner, async (db) => (await db.query("select public.get_business_entitlements($1) as e", [b])).rows[0].e);
    expect(ent.usage.voice_minutes).toBe(2);
    const conv = await pool.query("select status from public.agent_conversations where id = $1", [turn.conversation_id]);
    expect(conv.rows[0].status).toBe("closed");
    const n = await pool.query("select kind, recipient_email from public.notifications where business_id = $1 and kind = 'staff_call_summary'", [b]);
    expect(n.rows).toEqual([{ kind: "staff_call_summary", recipient_email: "call-owner@example.test" }]);
  });

  it("server-only functions are not callable by users", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner, "Guard Hotel");
    for (const sql of [
      "select public.record_voice_call($1, null, null, 'x', 10)",
      "select public.begin_agent_turn($1, gen_random_uuid(), 'website', null, null, 'hi', 'ref')",
    ]) {
      await expect(asUser(owner, (db) => db.query(sql, [b]))).rejects.toMatchObject({ code: "42501" });
    }
  });
});
