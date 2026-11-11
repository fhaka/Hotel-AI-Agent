"use client";

import { startTransition, useActionState, type FormEvent } from "react";

/**
 * Wraps a Server Action for a form. Submitting through onSubmit (instead of
 * only the `action` prop) prevents React from auto-resetting the form, so
 * users keep everything they typed when validation fails. The `action` prop
 * is still set so the form works before JavaScript loads.
 */
export function useStepAction<S extends { status: string }>(
  action: (state: Awaited<S>, formData: FormData) => Promise<S>,
  initial: Awaited<S> = { status: "idle" } as Awaited<S>,
) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, initial);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { state, pending, dispatch, onSubmit };
}
