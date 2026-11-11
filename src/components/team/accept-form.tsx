"use client";

import { useActionState } from "react";
import type { AcceptState } from "@/app/invite/[token]/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AcceptInvitationForm({ action }: { action: (state: AcceptState) => Promise<AcceptState> }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-4">
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}
