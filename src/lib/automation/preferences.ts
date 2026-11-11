import { z } from "zod";

/** business_settings.notification_preferences (defaults mirror the SQL helpers). */
export const notificationPreferencesSchema = z.object({
  guest_pre_arrival: z
    .object({ enabled: z.boolean().default(true), days_before: z.number().int().min(1).max(14).default(2) })
    .default({ enabled: true, days_before: 2 }),
  owner_daily_report: z
    .object({ enabled: z.boolean().default(true), hour: z.number().int().min(0).max(23).default(8) })
    .default({ enabled: true, hour: 8 }),
  staff_alerts: z
    .object({
      enabled: z.boolean().default(true),
      email: z.email().nullable().default(null),
      unanswered_after_hours: z.number().int().min(1).max(72).default(4),
    })
    .default({ enabled: true, email: null, unanswered_after_hours: 4 }),
});

export type NotificationPreferences = z.output<typeof notificationPreferencesSchema>;

export function readPreferences(value: unknown): NotificationPreferences {
  const parsed = notificationPreferencesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : notificationPreferencesSchema.parse({});
}

export function preferencesFromFormData(fd: FormData): unknown {
  const n = (k: string) => Number(fd.get(k));
  const email = String(fd.get("staffEmail") ?? "").trim().toLowerCase();
  return {
    guest_pre_arrival: { enabled: fd.get("preArrivalEnabled") === "on", days_before: n("preArrivalDays") },
    owner_daily_report: { enabled: fd.get("dailyReportEnabled") === "on", hour: n("dailyReportHour") },
    staff_alerts: { enabled: fd.get("staffAlertsEnabled") === "on", email: email || null, unanswered_after_hours: n("unansweredHours") },
  };
}
