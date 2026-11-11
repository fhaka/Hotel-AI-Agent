import type { Metadata } from "next";
import { savePreferences } from "@/app/dashboard/automations/actions";
import { PreferencesForm } from "@/components/automation/preferences-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { readPreferences } from "@/lib/automation/preferences";
import { formatInZone } from "@/lib/billing/trial";
import { emailConfigured } from "@/lib/email/send";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Automations" };

const KIND_LABEL: Record<string, string> = {
  guest_pre_arrival: "Guest pre-arrival reminder",
  owner_trial_ending: "Trial ending",
  owner_trial_ended: "Trial ended",
  owner_payment_failed: "Payment failed",
  staff_escalation: "Hand-over alert",
  staff_unanswered_inquiry: "Unanswered hand-over reminder",
  owner_daily_report: "Daily summary",
  owner_welcome: "Welcome",
};
const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "brand"> = {
  sent: "success",
  pending: "brand",
  sending: "brand",
  skipped: "neutral",
  failed: "danger",
};
const SKIP_REASON: Record<string, string> = {
  email_not_configured: "email sending not configured",
  reservation_not_confirmed: "booking no longer confirmed",
  already_handled: "already handled",
  already_subscribed: "already subscribed",
  payment_recovered: "payment recovered",
};

export default async function AutomationsPage() {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/automations");
  const supabase = await createClient();
  const canEdit = ent.can("business.edit");
  const [{ data: settings }, { data: log }, { data: health }, { data: biz }] = await Promise.all([
    supabase.from("business_settings").select("notification_preferences").eq("business_id", workspace.businessId).single(),
    canEdit
      ? supabase.from("notifications").select("id, kind, recipient_email, status, attempts, last_error, created_at, sent_at").eq("business_id", workspace.businessId).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] as never[] }),
    supabase.rpc("automation_health"),
    supabase.from("businesses").select("timezone").eq("id", workspace.businessId).single(),
  ]);
  const tz = biz?.timezone ?? "UTC";
  const h = (health ?? {}) as { last_run_at?: string | null; last_status?: string | null };
  const lastRun = h.last_run_at ? new Date(h.last_run_at) : null;
  const stale = !lastRun || Date.parse(ent.snapshot.evaluated_at) - lastRun.getTime() > 60 * 60 * 1000;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
        <p className="mt-1 text-sm text-muted">Reminders, summaries and alerts sent automatically. Booking confirmations are sent when a booking is made.</p>
      </div>

      {!emailConfigured() ? <Alert tone="warning" title="Email sending is not configured">Automated emails are skipped until RESEND_API_KEY and RESEND_FROM_EMAIL are set on the server.</Alert> : null}
      {stale ? (
        <Alert tone="warning" title="The scheduler hasn't run recently">
          {lastRun ? `Last run: ${formatInZone(lastRun, tz)}.` : "No scheduled run has been recorded yet."} Automations only go out when the platform&apos;s scheduled job runs.
        </Alert>
      ) : (
        <p className="text-sm text-muted">Scheduler healthy · last run {formatInZone(lastRun!, tz)}</p>
      )}

      <Card className="p-6 sm:p-8">
        <PreferencesForm
          action={savePreferences.bind(null, workspace.businessId)}
          prefs={readPreferences(settings?.notification_preferences)}
          isHotel={workspace.industry === "hotel"}
          guestEmailsAllowed={ent.canUseAutomation}
          readOnly={!canEdit}
        />
      </Card>

      {canEdit ? (
        <Card>
          <h2 className="border-b border-border px-6 py-4 text-base font-semibold">Recent automated emails</h2>
          {(log ?? []).length === 0 ? <p className="px-6 py-6 text-sm text-muted">Nothing sent yet.</p> : (
            <ul className="divide-y divide-border text-sm">
              {(log ?? []).map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                  <span>
                    <span className="font-medium">{KIND_LABEL[n.kind] ?? n.kind}</span>
                    <span className="text-muted"> · {n.recipient_email}</span>
                    {n.status === "skipped" || n.status === "failed" ? (
                      <span className="block text-xs text-muted">{SKIP_REASON[n.last_error ?? ""] ?? n.last_error}{n.attempts > 1 ? ` · ${n.attempts} attempts` : ""}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted">{formatInZone(new Date(n.sent_at ?? n.created_at), tz)}</span>
                    <Badge tone={STATUS_TONE[n.status] ?? "neutral"}>{n.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
