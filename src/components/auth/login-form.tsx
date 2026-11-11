"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resendVerification, signIn, type AuthFormState } from "@/app/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "./submit-button";

const initial: AuthFormState = { status: "idle" };

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, initial);
  const [resendState, resendAction] = useActionState(resendVerification, initial);
  const email = state.values?.email ?? "";

  return (
    <div className="space-y-4">
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}

      <form action={action} className="space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={email}
          error={state.fieldErrors?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={state.fieldErrors?.password}
        />
        <div className="flex justify-end">
          <Link href="/auth/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Forgot password?
          </Link>
        </div>
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </form>

      {state.values?.unconfirmed ? (
        <form action={resendAction} className="space-y-2">
          <input type="hidden" name="email" value={email} />
          {resendState.message ? (
            <Alert tone={resendState.status === "error" ? "danger" : "success"}>{resendState.message}</Alert>
          ) : null}
          <button type="submit" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Resend verification email
          </button>
        </form>
      ) : null}
    </div>
  );
}
