"use client";

import type { PrefsState } from "@/app/dashboard/automations/actions";
import { useStepAction } from "@/components/onboarding/use-step-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection } from "@/components/ui/form-controls";
import type { NotificationPreferences } from "@/lib/automation/preferences";

function Toggle({ name, label, hint, defaultChecked, disabled }: { name: string; label: string; hint: string; defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="mt-1 h-4 w-4 accent-brand-600" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
    </label>
  );
}

export function PreferencesForm({
  action,
  prefs,
  isHotel,
  guestEmailsAllowed,
  readOnly,
}: {
  action: (s: PrefsState, fd: FormData) => Promise<PrefsState>;
  prefs: NotificationPreferences;
  isHotel: boolean;
  guestEmailsAllowed: boolean;
  readOnly: boolean;
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const e = state.fieldErrors ?? {};
  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-8" noValidate>
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      <fieldset disabled={readOnly} className="space-y-8">
        {isHotel ? (
          <FormSection title="Guest reminders" description={guestEmailsAllowed ? "Sent to guests with an email address on confirmed bookings." : "Guest reminders need an active plan that includes automations (Growth or Business)."}>
            <Toggle name="preArrivalEnabled" label="Send a pre-arrival reminder" hint="Includes dates, room, check-in time, address and your contact details." defaultChecked={prefs.guest_pre_arrival.enabled} disabled={!guestEmailsAllowed} />
            <Field label="Days before check-in" name="preArrivalDays" type="number" min={1} max={14} defaultValue={String(prefs.guest_pre_arrival.days_before)} error={e["guest_pre_arrival.days_before"]} className="max-w-xs" />
          </FormSection>
        ) : (
          <input type="hidden" name="preArrivalDays" value={prefs.guest_pre_arrival.days_before} />
        )}
        <FormSection title="Daily summary" description="Emailed to the workspace owners once a day.">
          <Toggle name="dailyReportEnabled" label="Send the daily summary" hint={isHotel ? "Arrivals, departures, new bookings, AI conversations and open hand-overs." : "AI conversations, open hand-overs and usage."} defaultChecked={prefs.owner_daily_report.enabled} />
          <Field label="Send after (hour, 0–23, your time zone)" name="dailyReportHour" type="number" min={0} max={23} defaultValue={String(prefs.owner_daily_report.hour)} error={e["owner_daily_report.hour"]} className="max-w-xs" />
        </FormSection>
        <FormSection title="Staff alerts" description="When the AI hands a guest over to your team.">
          <Toggle name="staffAlertsEnabled" label="Email staff about hand-overs" hint="One alert when it happens and one reminder if it's still open." defaultChecked={prefs.staff_alerts.enabled} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Send alerts to (optional)" name="staffEmail" type="email" defaultValue={prefs.staff_alerts.email ?? ""} hint="Leave empty to alert all owners and admins." error={e["staff_alerts.email"]} />
            <Field label="Remind if still open after (hours)" name="unansweredHours" type="number" min={1} max={72} defaultValue={String(prefs.staff_alerts.unanswered_after_hours)} error={e["staff_alerts.unanswered_after_hours"]} />
          </div>
        </FormSection>
      </fieldset>
      {readOnly ? <p className="text-sm text-muted">Only owners and admins can change automations.</p> : (
        <div className="flex justify-end border-t border-border pt-6"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button></div>
      )}
    </form>
  );
}
