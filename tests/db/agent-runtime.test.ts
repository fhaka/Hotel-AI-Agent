import { afterAll, describe, expect, it } from "vitest";
import { addMember, asService, asUser, createUser, createWorkspace, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

async function agentId(businessId: string, type = "website_receptionist") {
  const { rows } = await pool.query("select id from public.agents where business_id = $1 and agent_type = $2", [businessId, type]);
  return rows[0].id as string;
}

function begin(businessId: string, agent: string, conversationId: string | null, startedBy: string, message = "Hello", channel = "playground") {
  return asService(async (db) => {
    const { rows } = await db.query(
      "select public.begin_agent_turn($1, $2, $3::public.conversation_channel, $4, $5, $6) as r",
      [businessId, agent, channel, conversationId, startedBy, message],
    );
    return rows[0].r;
  });
}

async function setMessageLimit(businessId: string, limit: number) {
  await asService((db) =>
    db.query("update public.subscriptions set status = 'active', plan_id = 'growth', current_period_start = now() - interval '1 day', current_period_end = now() + interval '29 days' where business_id = $1", [businessId]),
  );
  await asService((db) =>
    db.query("update public.plans set usage_limits = jsonb_set(usage_limits, '{ai_messages_per_month}', to_jsonb($1::int)) where id = 'growth'", [limit]),
  );
}

describe("begin_agent_turn", () => {
  it("creates a conversation, stores the customer message and reserves one AI message", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const a = await agentId(b);
    const r = await begin(b, a, null, owner, "What time is breakfast?");
    expect(r).toMatchObject({ allowed: true, messages_used: 1, messages_limit: 300 });
    const { rows } = await pool.query("select sender_type, content from public.agent_messages where conversation_id = $1", [r.conversation_id]);
    expect(rows).toEqual([{ sender_type: "customer", content: "What time is breakfast?" }]);
    const usage = await pool.query("select event_type, quantity from public.usage_events where business_id = $1", [b]);
    expect(usage.rows).toEqual([{ event_type: "ai_message", quantity: "1.0000" }]);
  });

  it("refuses expired trials, disabled agents and agents not in the plan", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const a = await agentId(b);
    await asService(async (db) => {
      await db.query("select set_config('hotelai.allow_trial_edit', 'on', true)");
      await db.query("update public.subscriptions set trial_started_at = now() - interval '8 days', trial_ends_at = now() - interval '1 day' where business_id = $1", [b]);
    });
    expect(await begin(b, a, null, owner)).toEqual({ allowed: false, reason: "trial_expired" });

    const b2 = await createWorkspace(await createUser(), "Hotel Two");
    const a2 = await agentId(b2);
    await asService((db) => db.query("update public.agents set enabled = false where id = $1", [a2]));
    expect(await begin(b2, a2, null, owner)).toEqual({ allowed: false, reason: "agent_disabled" });

    const voice = await agentId(b2, "voice_receptionist");
    expect(await begin(b2, voice, null, owner)).toEqual({ allowed: false, reason: "agent_unavailable" });

    const res = await agentId(b2, "reservation_assistant");
    await asService((db) => db.query("update public.subscriptions set status = 'active', plan_id = 'basic' where business_id = $1", [b2]));
    expect(await begin(b2, res, null, owner)).toEqual({ allowed: false, reason: "feature_not_in_plan" });
  });

  it("enforces the message limit exactly, even with concurrent requests", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const a = await agentId(b);
    await setMessageLimit(b, 3);
    try {
      const results = await Promise.all(Array.from({ length: 8 }, () => begin(b, a, null, owner)));
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
      expect(results.filter((r) => !r.allowed).every((r) => r.reason === "usage_limit_reached")).toBe(true);
    } finally {
      await asService((db) => db.query("update public.plans set usage_limits = jsonb_set(usage_limits, '{ai_messages_per_month}', '5000') where id = 'growth'"));
    }
  });

  it("rejects continuing another business's or another user's conversation", async () => {
    const ownerA = await createUser();
    const staffA = await createUser();
    const ownerB = await createUser();
    const bA = await createWorkspace(ownerA, "A Hotel");
    const bB = await createWorkspace(ownerB, "B Hotel");
    await addMember(bA, staffA, "staff");
    const aA = await agentId(bA);
    const aB = await agentId(bB);
    const convB = (await begin(bB, aB, null, ownerB)).conversation_id;
    // Business A cannot append to B's conversation, even with A's own agent.
    expect(await begin(bA, aA, convB, ownerA)).toEqual({ allowed: false, reason: "conversation_not_found" });
    // A staff member cannot continue the owner's playground conversation.
    const convA = (await begin(bA, aA, null, ownerA)).conversation_id;
    expect(await begin(bA, aA, convA, staffA)).toEqual({ allowed: false, reason: "conversation_not_found" });
    expect(await begin(bA, aA, convA, ownerA)).toMatchObject({ allowed: true, conversation_id: convA });
  });

  it("rejects empty or oversized messages", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const a = await agentId(b);
    expect(await begin(b, a, null, owner, "   ")).toEqual({ allowed: false, reason: "invalid_message" });
    expect(await begin(b, a, null, owner, "x".repeat(4001))).toEqual({ allowed: false, reason: "invalid_message" });
  });
});

describe("complete / fail / escalate", () => {
  it("records the reply, tool events and token usage", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const a = await agentId(b);
    const r = await begin(b, a, null, owner);
    await asService((db) =>
      db.query("select public.complete_agent_turn($1, $2, $3, $4, $5, $6, $7, $8)", [
        b, r.conversation_id, a, "Breakfast is 7–10.",
        JSON.stringify([{ name: "search_knowledge", summary: "1 result", ok: true }]), 1200, 80, "test-model",
      ]),
    );
    const msgs = await pool.query("select sender_type, tool_name, content from public.agent_messages where conversation_id = $1 order by id", [r.conversation_id]);
    expect(msgs.rows.map((m) => m.sender_type)).toEqual(["customer", "tool", "agent"]);
    expect(msgs.rows[1].tool_name).toBe("search_knowledge");
    const ent = await asUser(owner, async (db) => (await db.query("select public.get_business_entitlements($1) as e", [b])).rows[0].e);
    expect(ent.usage).toMatchObject({ ai_messages: 1, ai_tokens: 1280 });
  });

  it("releases the reserved message when the model fails", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const a = await agentId(b);
    const r = await begin(b, a, null, owner);
    await asService((db) => db.query("select public.fail_agent_turn($1, $2, $3, 'model_timeout')", [b, r.conversation_id, r.usage_event_id]));
    const ent = await asUser(owner, async (db) => (await db.query("select public.get_business_entitlements($1) as e", [b])).rows[0].e);
    expect(ent.usage.ai_messages).toBe(0);
    const msgs = await pool.query("select sender_type from public.agent_messages where conversation_id = $1 order by id", [r.conversation_id]);
    expect(msgs.rows.map((m) => m.sender_type)).toEqual(["customer", "system"]);
  });

  it("fail_agent_turn cannot delete another business's usage", async () => {
    const o1 = await createUser();
    const o2 = await createUser();
    const b1 = await createWorkspace(o1, "B1");
    const b2 = await createWorkspace(o2, "B2");
    const r1 = await begin(b1, await agentId(b1), null, o1);
    const r2 = await begin(b2, await agentId(b2), null, o2);
    await asService((db) => db.query("select public.fail_agent_turn($1, $2, $3, 'x')", [b2, r2.conversation_id, r1.usage_event_id]));
    const { rows } = await pool.query("select count(*)::int as n from public.usage_events where id = $1", [r1.usage_event_id]);
    expect(rows[0].n).toBe(1);
  });

  it("escalation only touches the given business's conversation", async () => {
    const o1 = await createUser();
    const o2 = await createUser();
    const b1 = await createWorkspace(o1, "E1");
    const b2 = await createWorkspace(o2, "E2");
    const r1 = await begin(b1, await agentId(b1), null, o1);
    const wrong = await asService(async (db) => (await db.query("select public.escalate_conversation($1, $2, '{}') as ok", [b2, r1.conversation_id])).rows[0].ok);
    expect(wrong).toBe(false);
    const right = await asService(async (db) => (await db.query(`select public.escalate_conversation($1, $2, '{"reason":"group booking"}') as ok`, [b1, r1.conversation_id])).rows[0].ok);
    expect(right).toBe(true);
    const { rows } = await asUser(o1, (db) => db.query("select status, escalation from public.agent_conversations where id = $1", [r1.conversation_id]));
    expect(rows[0]).toMatchObject({ status: "escalated", escalation: { reason: "group booking" } });
  });
});

describe("rate limits and server-only access", () => {
  it("allows up to the limit per window", async () => {
    const results = await asService(async (db) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) out.push((await db.query("select public.consume_rate_limit('test:user:1', 3, 60) as ok")).rows[0].ok);
      return out;
    });
    expect(results).toEqual([true, true, true, false]);
  });

  it("none of the runtime functions are callable by signed-in users", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const a = await agentId(b);
    for (const sql of [
      ["select public.begin_agent_turn($1, $2, 'playground', null, auth.uid(), 'hi')", [b, a]],
      ["select public.consume_rate_limit('x', 1, 1)", []],
      ["select public.escalate_conversation($1, gen_random_uuid(), '{}')", [b]],
      ["select public.purge_expired_conversations()", []],
    ] as const) {
      await expect(asUser(owner, (db) => db.query(sql[0], [...sql[1]]))).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      asUser(owner, (db) => db.query("insert into public.agent_messages (business_id, conversation_id, sender_type, content) values ($1, gen_random_uuid(), 'agent', 'fake')", [b])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("purges playground conversations past retention", async () => {
    const owner = await createUser();
    const b = await createWorkspace(owner);
    const r = await begin(b, await agentId(b), null, owner);
    // Backdate as a superuser fixture; the updated_at trigger would otherwise reset it.
    const client = await pool.connect();
    try {
      await client.query("begin; set local session_replication_role = replica");
      await client.query("update public.agent_conversations set updated_at = now() - interval '91 days' where id = $1", [r.conversation_id]);
      await client.query("commit");
    } finally {
      client.release();
    }
    const n = await asService(async (db) => (await db.query("select public.purge_expired_conversations() as n")).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query("select count(*)::int as n from public.agent_messages where conversation_id = $1", [r.conversation_id]);
    expect(rows[0].n).toBe(0);
  });
});
