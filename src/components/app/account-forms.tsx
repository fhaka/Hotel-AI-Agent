"use client";

import { useActionState } from "react";
import type { AccountState } from "@/app/dashboard/settings/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function ProfileForm({ action, fullName }: { action: (s: AccountState, fd: FormData) => Promise<AccountState>; fullName: string }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-4">
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      <Field label="Full name" name="fullName" defaultValue={fullName} autoComplete="name" error={state.fieldErrors?.fullName} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function PasswordResetForm({ action }: { action: (s: AccountState) => Promise<AccountState> }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-4">
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Sending…" : "Email me a password change link"}
      </Button>
    </form>
  );
}
