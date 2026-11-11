import { describe, expect, it } from "vitest";
import { formatInZone, summarizeTrial } from "@/lib/billing/trial";

const now = new Date("2026-11-11T12:00:00Z");

describe("summarizeTrial", () => {
  it("reports days and hours left during the trial", () => {
    const s = summarizeTrial({ status: "trialing", trial_ends_at: "2026-11-18T12:00:00Z" }, now);
    expect(s).toMatchObject({ kind: "trialing", daysLeft: 7, hoursLeft: 168 });
  });

  it("rounds partial days up (last day shows 1 day left)", () => {
    const s = summarizeTrial({ status: "trialing", trial_ends_at: "2026-11-11T13:00:00Z" }, now);
    expect(s).toMatchObject({ kind: "trialing", daysLeft: 1, hoursLeft: 1 });
  });

  it("treats a trialing row past its end as expired even before a job updates the status", () => {
    expect(summarizeTrial({ status: "trialing", trial_ends_at: "2026-11-11T12:00:00Z" }, now).kind).toBe("trial_expired");
  });

  it("handles incomplete (no trial available) and paid states", () => {
    expect(summarizeTrial({ status: "incomplete", trial_ends_at: null }, now).kind).toBe("needs_plan");
    expect(summarizeTrial({ status: "active", trial_ends_at: "2026-01-01T00:00:00Z" }, now)).toEqual({ kind: "paid", status: "active" });
    expect(summarizeTrial(null, now).kind).toBe("needs_plan");
  });
});

describe("formatInZone", () => {
  it("renders the instant in the business time zone", () => {
    expect(formatInZone(new Date("2026-11-18T12:00:00Z"), "Europe/Tirane")).toContain("13:00");
    expect(formatInZone(new Date("2026-11-18T12:00:00Z"), "America/New_York")).toContain("07:00");
  });
});
