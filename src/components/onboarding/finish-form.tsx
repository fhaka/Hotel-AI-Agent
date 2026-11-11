"use client";

import { useActionState } from "react";
import type { StepFormState } from "@/app/onboarding/actions";
import { FormError, StepActions } from "./step-actions";

export function FinishForm({
  action,
  backHref,
  ready,
  alreadyCompleted,
}: {
  action: (state: StepFormState) => Promise<StepFormState>;
  backHref: string;
  ready: boolean;
  alreadyCompleted: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-4">
      <FormError message={state.message} />
      {ready ? (
        <StepActions
          pending={pending}
          submitLabel={alreadyCompleted ? "Back to dashboard" : "Finish setup"}
          backHref={backHref}
        />
      ) : (
        <p className="text-sm text-muted">Complete the steps marked as missing above to finish setup.</p>
      )}
    </form>
  );
}
