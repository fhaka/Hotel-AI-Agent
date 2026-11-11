"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { StepFormState } from "@/app/onboarding/actions";

const initial: StepFormState = { status: "idle" };

/**
 * Wraps a step's Server Action. Submitting through onSubmit (instead of only
 * the `action` prop) prevents React from auto-resetting the form, so users
 * keep everything they typed when validation fails. The `action` prop is
 * still set so the form works before JavaScript loads.
 */
export function useStepAction(action: (state: StepFormState, formData: FormData) => Promise<StepFormState>) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { state, pending, dispatch, onSubmit };
}
