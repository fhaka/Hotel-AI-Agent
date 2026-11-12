import { describe, expect, it, vi } from "vitest";
import { parseLimits, retentionSchema, suspensionSchema } from "@/lib/admin/schemas";
import { assessLaunchReadiness, readinessSummary } from "@/lib/launch/readiness";
import { buildErrorReport, redactPath, reportServerError } from "@/lib/observability/errors";
import { buildCsp, INLINE_SCRIPT_HASHES, newNonce } from "@/lib/security/csp";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("content security policy", () => {
  const base = { nonce: "abc123==", dev: false, frameAncestors: [], supabaseUrl: "https://proj.supabase.co" };

  it("allows scripts only by nonce, known hash or allow-listed origin", () => {
    const csp = buildCsp(base);
    const script = directive(csp, "script-src");
    expect(script).toContain("'nonce-abc123=='");
    expect(script).toContain(INLINE_SCRIPT_HASHES[0]);
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("blocks framing unless ancestors are given (widget)", () => {
    expect(directive(buildCsp(base), "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(buildCsp({ ...base, frameAncestors: ["'self'", "https://hotel.example"] }), "frame-ancestors")).toBe(
      "frame-ancestors 'self' https://hotel.example",
    );
  });

  it("connects to the Supabase project (https and websocket) and Paddle only", () => {
    const connect = directive(buildCsp(base), "connect-src");
    expect(connect).toBe("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co https://*.paddle.com");
    expect(directive(buildCsp({ ...base, supabaseUrl: "not a url" }), "connect-src")).toBe("connect-src 'self' https://*.paddle.com");
  });

  it("relaxes only what development tooling needs", () => {
    const csp = buildCsp({ ...base, dev: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("generates unpredictable nonces", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});

describe("launch readiness", () => {
  const full = {
    NEXT_PUBLIC_APP_URL: "https://app.hotelai.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxxxxxx",
    SUPABASE_SECRET_KEY: "sb_secret_xxxxxxxxxxxxxxxxxxxx",
    OPENAI_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
    OPENAI_MODEL: "some-model",
    RESEND_API_KEY: "re_xxxxxxxxxx",
    RESEND_FROM_EMAIL: "HotelAI <hello@mail.hotelai.example>",
    CRON_SECRET: "x".repeat(64),
    PADDLE_API_KEY: "pdl_xxxxxxxxxxxx",
    PADDLE_WEBHOOK_SECRET: "pdl_ntfset_xxxxxxxx",
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_xxxxxxxxxx",
    PADDLE_ENVIRONMENT: "production",
    PADDLE_PRICE_BASIC_MONTHLY: "pri_1",
    PADDLE_PRICE_BASIC_YEARLY: "pri_2",
    PADDLE_PRICE_GROWTH_MONTHLY: "pri_3",
    PADDLE_PRICE_GROWTH_YEARLY: "pri_4",
    PADDLE_PRICE_BUSINESS_MONTHLY: "pri_5",
    PADDLE_PRICE_BUSINESS_YEARLY: "pri_6",
    NEXT_PUBLIC_COMPANY_NAME: "HotelAI sh.p.k.",
    NEXT_PUBLIC_COMPANY_ADDRESS: "Rruga Example 1, Tirana",
    NEXT_PUBLIC_SUPPORT_EMAIL: "support@hotelai.example",
  };

  it("passes a complete production configuration (Twilio optional)", () => {
    const s = readinessSummary(assessLaunchReadiness(full));
    expect(s).toEqual({ ready: true, blocking: 0, warnings: 1 });
  });

  it("flags sandbox billing, localhost URLs, weak cron secrets and missing prices", () => {
    const checks = assessLaunchReadiness({ ...full, PADDLE_ENVIRONMENT: "sandbox", NEXT_PUBLIC_APP_URL: "http://localhost:3000", CRON_SECRET: "short", PADDLE_PRICE_GROWTH_YEARLY: "" });
    const failed = checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["paddle_live", "app_url", "cron_secret", "paddle_prices"]));
    expect(checks.find((c) => c.id === "paddle_prices")?.message).toContain("PADDLE_PRICE_GROWTH_YEARLY");
  });

  it("never includes values in its messages", () => {
    const text = JSON.stringify(assessLaunchReadiness(full));
    for (const [k, v] of Object.entries(full)) if (k !== "PADDLE_ENVIRONMENT") expect(text).not.toContain(v);
  });
});

describe("error reporting", () => {
  it("redacts query strings and token-like path segments but keeps ids", () => {
    expect(redactPath("/invite/AbCdEf0123456789AbCdEf0123456789?x=secret")).toBe("/invite/:redacted");
    expect(redactPath("/dashboard/guests/0b6f2a0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toBe("/dashboard/guests/0b6f2a0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
    expect(redactPath("/widget/wk_0123456789abcdef0123456789abcdef")).toBe("/widget/:redacted");
  });

  it("builds a compact report with the digest and route context", () => {
    const err = Object.assign(new Error("boom"), { digest: "123" });
    const r = buildErrorReport(err, { path: "/dashboard?q=1", method: "GET" }, { routePath: "/dashboard", routeType: "render" }, new Date("2026-11-12T10:00:00Z"));
    expect(r).toMatchObject({ level: "error", event: "server_error", message: "boom", digest: "123", path: "/dashboard", routeType: "render", time: "2026-11-12T10:00:00.000Z" });
    expect(buildErrorReport("x".repeat(2000), { path: "/", method: "GET" }, {}).message).toHaveLength(500);
  });

  it("logs every error and forwards to the webhook with a throttle", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const report = buildErrorReport(new Error("x"), { path: "/", method: "GET" }, {});
    for (let i = 0; i < 15; i++) await reportServerError(report, { webhookUrl: "https://alerts.example/hook", fetch: fetchMock as unknown as typeof fetch, now: 1_000_000 });
    expect(log).toHaveBeenCalledTimes(15);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    await reportServerError(report, { webhookUrl: "http://insecure.example", fetch: fetchMock as unknown as typeof fetch, now: 9_000_000 });
    expect(fetchMock).toHaveBeenCalledTimes(10);
    log.mockRestore();
  });

  it("never throws when the webhook fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(reportServerError(buildErrorReport(new Error("x"), { path: "/", method: "GET" }, {}), { webhookUrl: "https://a.example", fetch: failing as unknown as typeof fetch, now: 99_000_000 })).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe("operator input validation", () => {
  const fd = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  it("parses limit fields, treating empty as 'not set'", () => {
    expect(parseLimits(fd({ "limit.ai_messages_per_month": "5000", "limit.members": "", "limit.agents": " 3 " }))).toEqual({
      ok: true,
      limits: { ai_messages_per_month: 5000, agents: 3 },
    });
    expect(parseLimits(fd({ "limit.members": "-1" })).ok).toBe(false);
    expect(parseLimits(fd({ "limit.members": "1.5" })).ok).toBe(false);
    expect(parseLimits(fd({ "limit.members": "99999999999" })).ok).toBe(false);
  });

  it("requires a reason to suspend", () => {
    expect(suspensionSchema.safeParse({ suspended: "true", reason: "" }).success).toBe(false);
    expect(suspensionSchema.safeParse({ suspended: "true", reason: "Fraud report" }).success).toBe(true);
    expect(suspensionSchema.safeParse({ suspended: "false" }).success).toBe(true);
  });

  it("keeps retention within sane bounds", () => {
    const ok = { playground_retention_days: "90", conversation_retention_days: "730", notification_days: "180", job_run_days: "90", webhook_payload_days: "90", audit_log_days: "730" };
    expect(retentionSchema.safeParse(ok).success).toBe(true);
    expect(retentionSchema.safeParse({ ...ok, audit_log_days: "1" }).success).toBe(false);
  });
});
