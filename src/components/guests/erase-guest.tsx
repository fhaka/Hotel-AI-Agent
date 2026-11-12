"use client";

import { useActionState } from "react";
import type { GuestState } from "@/app/dashboard/guests/actions";
import { Alert } from "@/components/ui/alert";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";

export function EraseGuestForm({ action }: { action: (s: GuestState) => Promise<GuestState> }) {
  const [state, dispatch] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-3">
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      <ConfirmSubmit
        label="Erase personal data"
        title="Erase this guest's personal data?"
        description="Name, email, phone, notes and special requests are removed for good. Reservations stay (dates, room, price) for your accounting. This cannot be undone."
        confirmLabel="Erase"
      />
    </form>
  );
}
