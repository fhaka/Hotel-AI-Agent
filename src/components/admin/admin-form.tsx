"use client";

import { useActionState, type ReactNode } from "react";
import type { AdminState } from "@/app/admin/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Small form wrapper for operator actions: status message + submit button. */
export function AdminForm({
  action,
  submitLabel,
  pendingLabel = "Saving…",
  variant = "primary",
  children,
  className,
}: {
  action: (state: AdminState, formData: FormData) => Promise<AdminState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className={className ?? "space-y-4"}>
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      {children}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
