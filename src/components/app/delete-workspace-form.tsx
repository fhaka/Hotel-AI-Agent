"use client";

import { useActionState } from "react";
import type { PrivacyState } from "@/app/dashboard/privacy/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function DeleteWorkspaceForm({ action, name }: { action: (s: PrivacyState, fd: FormData) => Promise<PrivacyState>; name: string }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-4">
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Field label={`Type "${name}" to confirm`} name="confirmName" autoComplete="off" required />
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete workspace permanently"}
      </Button>
    </form>
  );
}
