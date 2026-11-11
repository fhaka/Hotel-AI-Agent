/**
 * Describes a subscription's trial state for DISPLAY purposes. Access
 * decisions are made server-side by the entitlement service (Phase 3),
 * which compares against the database clock.
 */
export type SubscriptionLike = {
  status: string;
  trial_ends_at: string | null;
};

export type TrialSummary =
  | { kind: "trialing"; endsAt: Date; daysLeft: number; hoursLeft: number }
  | { kind: "trial_expired"; endedAt: Date }
  | { kind: "paid"; status: string }
  | { kind: "needs_plan" };

const HOUR = 60 * 60 * 1000;

export function summarizeTrial(sub: SubscriptionLike | null, now: Date): TrialSummary {
  if (!sub) return { kind: "needs_plan" };
  if (sub.status === "trialing" && sub.trial_ends_at) {
    const endsAt = new Date(sub.trial_ends_at);
    const remaining = endsAt.getTime() - now.getTime();
    if (remaining <= 0) return { kind: "trial_expired", endedAt: endsAt };
    return {
      kind: "trialing",
      endsAt,
      hoursLeft: Math.ceil(remaining / HOUR),
      daysLeft: Math.ceil(remaining / (24 * HOUR)),
    };
  }
  if (sub.status === "expired" && sub.trial_ends_at) return { kind: "trial_expired", endedAt: new Date(sub.trial_ends_at) };
  if (sub.status === "incomplete" || sub.status === "expired") return { kind: "needs_plan" };
  return { kind: "paid", status: sub.status };
}

/** Formats a UTC instant in the business's own time zone. */
export function formatInZone(date: Date, timeZone: string, locale = "en-GB"): string {
  // dateStyle/timeStyle cannot be combined with timeZoneName, so spell out fields.
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}
