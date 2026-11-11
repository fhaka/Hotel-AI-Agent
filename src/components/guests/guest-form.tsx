"use client";

import type { GuestState } from "@/app/dashboard/guests/actions";
import { useStepAction } from "@/components/onboarding/use-step-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextAreaField } from "@/components/ui/form-controls";

export function GuestForm({
  action,
  defaults,
}: {
  action: (s: GuestState, fd: FormData) => Promise<GuestState>;
  defaults: { fullName: string; email: string; phone: string; preferredLanguage: string; notes: string };
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const e = state.fieldErrors ?? {};
  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" name="fullName" defaultValue={defaults.fullName} error={e.fullName} />
        <Field label="Email" name="email" type="email" defaultValue={defaults.email} error={e.email} />
        <Field label="Phone" name="phone" type="tel" defaultValue={defaults.phone} error={e.phone} />
        <Field label="Preferred language" name="preferredLanguage" maxLength={5} defaultValue={defaults.preferredLanguage} error={e.preferredLanguage} />
      </div>
      <TextAreaField label="Internal notes" name="notes" rows={3} defaultValue={defaults.notes} error={e.notes} hint="Visible to your team only. Not shared with AI agents." />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save guest"}</Button>
    </form>
  );
}
