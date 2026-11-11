"use client";

import { useActionState } from "react";
import type { ResolveState } from "@/app/dashboard/conversations/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function ResolveButton({ action }: { action: (s: ResolveState) => Promise<ResolveState> }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-2">
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      {state.status !== "success" ? <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Mark as handled"}</Button> : null}
    </form>
  );
}
