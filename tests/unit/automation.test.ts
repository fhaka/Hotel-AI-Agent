import { describe, expect, it, vi } from "vitest";
import { preferencesFromFormData, readPreferences, notificationPreferencesSchema } from "@/lib/automation/preferences";
import { dailyReportEmail, escalationEmail, preArrivalEmail } from "@/lib/automation/templates";
import { hasValidBearer } from "@/lib/security/bearer";

vi.mock("server-only", () => ({}));

describe("preferences", () => {
  it("fills defaults and drops unknown values", () => {
    expect(readPreferences({ staff_alerts: { email: "desk@hotel.example" }, junk: 1 })).toEqual({
      guest_pre_arrival: { enabled: true, days_before: 2 },
      owner_daily_report: { enabled: true, hour: 8 },
      staff_alerts: { enabled: true, email: "desk@hotel.example", unanswered_after_hours: 4 },
    });
    expect(readPreferences("garbage").owner_daily_report.hour).toBe(8);
  });
  it("parses the settings form and validates ranges", () => {
    const fd = new FormData();
    fd.set("preArrivalEnabled", "on");
    fd.set("preArrivalDays", "3");
    fd.set("dailyReportHour", "7");
    fd.set("staffAlertsEnabled", "on");
    fd.set("staffEmail", " Desk@Hotel.Example ");
    fd.set("unansweredHours", "6");
    expect(notificationPreferencesSchema.parse(preferencesFromFormData(fd))).toEqual({
      guest_pre_arrival: { enabled: true, days_before: 3 },
      owner_daily_report: { enabled: false, hour: 7 },
      staff_alerts: { enabled: true, email: "desk@hotel.example", unanswered_after_hours: 6 },
    });
    fd.set("dailyReportHour", "25");
    expect(notificationPreferencesSchema.safeParse(preferencesFromFormData(fd)).success).toBe(false);
  });
});

describe("templates", () => {
  it("escape guest- and AI-provided text", () => {
    const e = escalationEmail({
      businessName: "Hotel",
      unanswered: true,
      hoursOpen: 5,
      reason: "<img src=x onerror=alert(1)> wants a group booking",
      customerName: "Eve <b>",
      customerEmail: "eve@example.test",
      customerPhone: null,
      conversationUrl: "https://app.example/dashboard/conversations/1",
    });
    expect(e.html).not.toContain("<img");
    expect(e.html).toContain("&lt;img");
    expect(e.subject).toMatch(/^Reminder: /);
    expect(e.text).toContain("Still waiting for a reply (5 h)");
  });
  it("pre-arrival and daily report contain the key facts", () => {
    const p = preArrivalEmail({ businessName: "Hotel A", guestName: "Gina", reference: "ABCDEF0123", checkIn: "Fri, 20 Nov 2026", checkOut: "Sun, 22 Nov 2026", roomType: "Double", checkInTime: "14:00", address: "Beach 1, Durrës", phone: "+355 1", email: null });
    expect(p.text).toContain("Check-in: Fri, 20 Nov 2026 from 14:00");
    expect(p.text).toContain("ABCDEF0123");
    const d = dailyReportEmail({ businessName: "Hotel A", dashboardUrl: "https://x", isHotel: false, report: { date: "x", arrivals: 1, departures: 1, inHouse: 1, newBookings24h: 1, aiBookings24h: 0, conversations24h: 4, openEscalations: 1, aiMessagesUsed: 10, aiMessagesLimit: 300 } });
    expect(d.text).not.toContain("Arrivals");
    expect(d.text).toContain("AI messages this period: 10 / 300");
  });
});

describe("bearer check", () => {
  const secret = "s".repeat(40);
  it("accepts only the exact secret and requires a strong secret", () => {
    expect(hasValidBearer(`Bearer ${secret}`, secret)).toBe(true);
    expect(hasValidBearer(`Bearer ${secret}x`, secret)).toBe(false);
    expect(hasValidBearer(secret, secret)).toBe(false);
    expect(hasValidBearer(null, secret)).toBe(false);
    expect(hasValidBearer("Bearer short", "short")).toBe(false);
    expect(hasValidBearer(`Bearer ${secret}`, undefined)).toBe(false);
  });
});

describe("runScheduledJobs", () => {
  function fakeAdmin(claimBatches: unknown[][], failures: Record<string, boolean> = {}) {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (failures[fn]) return { data: null, error: { code: "XX000", message: "boom" } };
      if (fn === "claim_notifications") return { data: claimBatches.shift() ?? [], error: null };
      if (fn === "enqueue_due_notifications") return { data: { owner_welcome: 1 }, error: null };
      return { data: 0, error: null };
    });
    return { admin: { rpc } as never, calls };
  }
  const n = (id: string, kind = "owner_welcome") => ({ id, kind, business_id: "b", recipient_email: `${id}@example.test` });

  it("sends, skips, retries and fails according to render/send results, with idempotency keys", async () => {
    const { runScheduledJobs } = await import("@/lib/automation/worker");
    const { admin, calls } = fakeAdmin([[n("a"), n("b"), n("c"), n("d"), n("e")]]);
    const send = vi.fn(async (input: { to: string; idempotencyKey: string }) => {
      if (input.to.startsWith("a")) return { status: "sent" as const, id: "em_1" };
      if (input.to.startsWith("c")) return { status: "failed" as const, retryable: true, code: "rate_limit_exceeded" };
      if (input.to.startsWith("d")) return { status: "failed" as const, retryable: false, code: "validation_error" };
      return { status: "not_configured" as const };
    });
    const render = vi.fn(async (_a: unknown, row: { id: string }) =>
      row.id === "b" ? { action: "skip" as const, reason: "already_handled" } : { action: "send" as const, email: { subject: "s", html: "h", text: "t" } },
    );
    const result = await runScheduledJobs({ admin, send: send as never, render: render as never });
    expect(result.stats.notifications).toEqual({ sent: 1, retry: 1, failed: 1, skipped: 2 });
    expect(send.mock.calls.map((c) => c[0].idempotencyKey)).toEqual(["notification:a", "notification:c", "notification:d", "notification:e"]);
    const completes = calls.filter((c) => c.fn === "complete_notification").map((c) => [c.args?.p_id, c.args?.p_outcome, c.args?.p_error]);
    expect(completes).toEqual([
      ["a", "sent", null],
      ["b", "skipped", "already_handled"],
      ["c", "retry", "rate_limit_exceeded"],
      ["d", "failed", "validation_error"],
      ["e", "skipped", "email_not_configured"],
    ]);
    expect(result.status).toBe("ok");
    expect(calls.map((c) => c.fn)).toEqual(expect.arrayContaining(["expire_trials", "enqueue_due_notifications", "purge_expired_conversations", "record_job_run"]));
  });

  it("keeps going when one step fails and reports a partial run", async () => {
    const { runScheduledJobs } = await import("@/lib/automation/worker");
    const { admin, calls } = fakeAdmin([], { enqueue_due_notifications: true });
    const result = await runScheduledJobs({ admin, send: vi.fn() as never, render: vi.fn() as never });
    expect(result.status).toBe("partial");
    expect(result.stats.errors[0]).toMatch(/^enqueue: enqueue_due_notifications failed/);
    expect(calls.some((c) => c.fn === "purge_expired_conversations")).toBe(true);
    expect(calls.at(-1)).toMatchObject({ fn: "record_job_run", args: { p_status: "partial" } });
  });

  it("a render exception becomes a retry, not a crash", async () => {
    const { runScheduledJobs } = await import("@/lib/automation/worker");
    const { admin } = fakeAdmin([[n("x")]]);
    const result = await runScheduledJobs({ admin, send: vi.fn() as never, render: vi.fn(async () => { throw new Error("db timeout"); }) as never });
    expect(result.stats.notifications.retry).toBe(1);
  });
});
