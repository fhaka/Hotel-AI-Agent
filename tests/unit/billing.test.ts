import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePaddleEvent } from "@/lib/billing/paddle-normalize";
import { planForPriceId, priceIdFor, readPriceMap } from "@/lib/billing/prices";

vi.mock("server-only", () => ({}));

const ENV = {
  PADDLE_PRICE_BASIC_MONTHLY: "pri_basic_m",
  PADDLE_PRICE_GROWTH_MONTHLY: "pri_growth_m",
  PADDLE_PRICE_GROWTH_YEARLY: " pri_growth_y ",
  PADDLE_PRICE_BUSINESS_YEARLY: "",
};

describe("price map", () => {
  const map = readPriceMap(ENV);
  it("reads configured prices only, trimmed", () => {
    expect(map).toEqual([
      { planId: "basic", interval: "month", priceId: "pri_basic_m" },
      { planId: "growth", interval: "month", priceId: "pri_growth_m" },
      { planId: "growth", interval: "year", priceId: "pri_growth_y" },
    ]);
  });
  it("maps both directions", () => {
    expect(priceIdFor(map, "growth", "year")).toBe("pri_growth_y");
    expect(priceIdFor(map, "business", "year")).toBeNull();
    expect(planForPriceId(map, "pri_basic_m")).toEqual({ planId: "basic", interval: "month" });
    expect(planForPriceId(map, "pri_unknown")).toBeNull();
  });
});

describe("normalizePaddleEvent (wire format)", () => {
  const map = readPriceMap(ENV);
  const sub = {
    id: "sub_1",
    status: "active",
    customer_id: "ctm_1",
    canceled_at: null,
    current_billing_period: { starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" },
    billing_cycle: { interval: "month", frequency: 1 },
    scheduled_change: null,
    items: [{ price: { id: "pri_growth_m" } }],
    custom_data: { checkout_id: "3f1c2a1e-0000-4000-8000-000000000000", business_id: "attacker-supplied-is-ignored" },
  };
  const ev = (event_type: string, data: unknown, occurred_at = "2026-11-01T00:00:01Z") => ({ event_id: "evt_1", event_type, occurred_at, data });

  it("normalizes an active subscription and never uses custom_data.business_id", () => {
    const e = normalizePaddleEvent(ev("subscription.created", sub), map);
    expect(e.subscription).toEqual({
      id: "sub_1",
      customer_id: "ctm_1",
      status: "active",
      plan_id: "growth",
      interval: "month",
      period_start: "2026-11-01T00:00:00Z",
      period_end: "2026-12-01T00:00:00Z",
      cancel_at_period_end: false,
      checkout_id: "3f1c2a1e-0000-4000-8000-000000000000",
    });
    expect(JSON.stringify(e)).not.toContain("attacker-supplied");
  });

  it("detects scheduled cancellation and canceled subscriptions", () => {
    expect(normalizePaddleEvent(ev("subscription.updated", { ...sub, scheduled_change: { action: "cancel", effective_at: "2026-12-01T00:00:00Z" } }), map).subscription?.cancel_at_period_end).toBe(true);
    const canceled = normalizePaddleEvent(ev("subscription.canceled", { ...sub, status: "canceled", current_billing_period: null, canceled_at: "2026-11-20T00:00:00Z" }), map);
    expect(canceled.subscription).toMatchObject({ status: "canceled", period_end: "2026-11-20T00:00:00Z" });
  });

  it("never guesses a plan for an unknown price", () => {
    const e = normalizePaddleEvent(ev("subscription.created", { ...sub, items: [{ price: { id: "pri_other" } }] }), map);
    expect(e.subscription?.plan_id).toBeNull();
    expect(e.summary).toMatchObject({ knownPrice: false });
  });

  it("treats a subscription event without an id as malformed instead of applying it", () => {
    expect(normalizePaddleEvent(ev("subscription.updated", { status: "active" }), map)).toMatchObject({ subscription: null, summary: { malformed: true } });
  });

  it("links transaction events to their subscription without treating them as state", () => {
    expect(normalizePaddleEvent(ev("transaction.payment_failed", { subscription_id: "sub_1" }), map)).toMatchObject({ subscription: null, relatedSubscriptionId: "sub_1" });
  });
});

// ---------------------------------------------------------------------------
// Webhook handler with the REAL Paddle SDK signature verification
// ---------------------------------------------------------------------------
const SECRET = "pdl_ntfset_test_secret";

function paddleBody(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return JSON.stringify({
    event_id: "evt_01test",
    notification_id: "ntf_01test",
    event_type: "subscription.created",
    occurred_at: now,
    data: {
      id: "sub_01test",
      status: "active",
      customer_id: "ctm_01test",
      address_id: "add_01test",
      business_id: null,
      currency_code: "EUR",
      created_at: now,
      updated_at: now,
      started_at: now,
      first_billed_at: now,
      next_billed_at: "2026-12-11T00:00:00Z",
      paused_at: null,
      canceled_at: null,
      discount: null,
      collection_mode: "automatic",
      billing_details: null,
      current_billing_period: { starts_at: "2026-11-11T00:00:00Z", ends_at: "2026-12-11T00:00:00Z" },
      billing_cycle: { interval: "month", frequency: 1 },
      scheduled_change: null,
      items: [
        {
          status: "active",
          quantity: 1,
          recurring: true,
          created_at: now,
          updated_at: now,
          previously_billed_at: null,
          next_billed_at: null,
          trial_dates: null,
          price: { id: "pri_growth_m", product_id: "pro_01", description: "Growth monthly", name: null, billing_cycle: { interval: "month", frequency: 1 }, unit_price: { amount: "19900", currency_code: "EUR" }, status: "active", custom_data: null, import_meta: null, created_at: now, updated_at: now, type: "standard", trial_period: null, tax_mode: "account_setting", unit_price_overrides: [], quantity: { minimum: 1, maximum: 1 } },
          product: null,
        },
      ],
      custom_data: { checkout_id: "3f1c2a1e-0000-4000-8000-000000000000" },
      import_meta: null,
      consent_requirements: null,
    },
    ...overrides,
  });
}

function sign(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const h1 = createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

function request(body: string, signature: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("paddle-signature", signature);
  return new Request("http://localhost/api/billing/webhook", { method: "POST", headers, body });
}

describe("billing webhook handler (real Paddle SDK verification)", () => {
  const env = { ...process.env };
  const rpc = vi.fn();
  const admin = () => ({ rpc }) as never;

  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { result: "applied" }, error: null });
    Object.assign(process.env, ENV, { PADDLE_API_KEY: "pdl_sdbx_apikey_dummy", PADDLE_WEBHOOK_SECRET: SECRET, PADDLE_ENVIRONMENT: "sandbox" });
  });
  afterEach(() => {
    process.env = { ...env };
  });

  async function handler() {
    return (await import("@/lib/billing/webhook-handler")).handleBillingWebhook;
  }

  it("accepts a correctly signed event and applies the normalized subscription", async () => {
    const body = paddleBody();
    const res = await (await handler())(request(body, sign(body)), { admin });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: "applied" });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("apply_billing_event");
    expect(args).toMatchObject({
      p_provider: "paddle",
      p_event_id: "evt_01test",
      p_event_type: "subscription.created",
      p_subscription: {
        id: "sub_01test",
        customer_id: "ctm_01test",
        status: "active",
        plan_id: "growth",
        interval: "month",
        period_end: "2026-12-11T00:00:00Z",
        checkout_id: "3f1c2a1e-0000-4000-8000-000000000000",
      },
    });
    // Stored payload is a minimal summary, not the raw provider data.
    expect(JSON.stringify(args.p_payload)).not.toContain("add_01test");
  });

  it.each([
    ["tampered body", (b: string) => request(b.replace('"active"', '"paused"'), sign(b))],
    ["wrong secret", (b: string) => request(b, sign(b, "pdl_ntfset_other"))],
    ["replayed (old timestamp)", (b: string) => request(b, sign(b, SECRET, Math.floor(Date.now() / 1000) - 60))],
    ["missing signature", (b: string) => request(b, null)],
    ["garbage signature", (b: string) => request(b, "nonsense")],
  ])("rejects a %s with 401 and processes nothing", async (_name, build) => {
    const res = await (await handler())(build(paddleBody()), { admin });
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("processes an authentic event with a minimal/unexpected shape instead of calling it forged", async () => {
    const body = JSON.stringify({ event_id: "evt_min", event_type: "transaction.completed", occurred_at: new Date().toISOString(), notification_id: "ntf", data: { subscription_id: "sub_x" } });
    const res = await (await handler())(request(body, sign(body)), { admin });
    expect(res.status).toBe(200);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_event_type: "transaction.completed", p_related_subscription_id: "sub_x", p_subscription: null });
  });

  it("returns 400 (not 401) for an authentic but unusable payload", async () => {
    const body = JSON.stringify({ hello: "world" });
    const res = await (await handler())(request(body, sign(body)), { admin });
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 503 when billing is not configured", async () => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
    const body = paddleBody();
    const res = await (await handler())(request(body, sign(body)), { admin });
    expect(res.status).toBe(503);
  });

  it("returns 500 on database errors so the provider retries (processing is idempotent)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    const body = paddleBody();
    const res = await (await handler())(request(body, sign(body)), { admin });
    expect(res.status).toBe(500);
  });

  it("acknowledges events that can't be resolved (retrying would not help)", async () => {
    rpc.mockResolvedValue({ data: { result: "unresolved" }, error: null });
    const body = paddleBody();
    const res = await (await handler())(request(body, sign(body)), { admin });
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("unresolved");
  });
});
