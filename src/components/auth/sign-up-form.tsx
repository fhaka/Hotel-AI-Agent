"use client";

import { useActionState } from "react";
import { signUp, type AuthFormState } from "@/app/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { PASSWORD_MIN } from "@/lib/auth/validation";
import { SubmitButton } from "./submit-button";

const initial: AuthFormState = { status: "idle" };

export function SignUpForm({ next, email }: { next?: string; email?: string }) {
  const [state, action] = useActionState(signUp, initial);

  if (state.status === "success") {
    return (
      <Alert tone="success" title="Check your inbox">
        {state.message} The link expires after a while, so use it soon. You can close this tab.
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Field
        label="Full name"
        name="fullName"
        autoComplete="name"
        required
        defaultValue={state.values?.fullName}
        error={state.fieldErrors?.fullName}
      />
      <Field
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email ?? email}
        error={state.fieldErrors?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        hint={`At least ${PASSWORD_MIN} characters, including a letter and a number.`}
        error={state.fieldErrors?.password}
      />
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      {next?.startsWith("/invite/") ? null : (
        <p className="text-xs text-muted">
          Your 7-day free trial starts when you create your business workspace. No payment card required.
        </p>
      )}
    </form>
  );
}
