"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/dashboard/reservations/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { Field } from "@/components/ui/field";
import { STATUS_INFO, type ReservationStatus } from "@/lib/reservations/status";

type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;

function Result({ state }: { state: ActionState }) {
  return state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null;
}

const STATUS_VERB: Partial<Record<ReservationStatus, string>> = {
  confirmed: "Confirm",
  checked_in: "Check in",
  checked_out: "Check out",
  no_show: "Mark no-show",
};

export function StatusButtons({ action, next }: { action: Action; next: ReservationStatus[] }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const buttons = next.filter((s) => s !== "canceled");
  if (!buttons.length) return null;
  return (
    <div className="space-y-2">
      <Result state={state} />
      <div className="flex flex-wrap gap-2">
        {buttons.map((s) => (
          <form key={s} action={dispatch}>
            <input type="hidden" name="status" value={s} />
            <Button type="submit" size="sm" variant={s === "no_show" ? "secondary" : "primary"} disabled={pending}>
              {STATUS_VERB[s] ?? STATUS_INFO[s].label}
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}

export function CancelForm({ action, emailConfigured }: { action: Action; emailConfigured: boolean }) {
  const [state, dispatch] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-3">
      <Result state={state} />
      <Field label="Reason (internal)" name="reason" maxLength={1000} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="notifyGuest" defaultChecked={emailConfigured} disabled={!emailConfigured} className="h-4 w-4 accent-brand-600" />
        Email the guest about the cancellation
      </label>
      <ConfirmSubmit
        label="Cancel reservation"
        title="Cancel this reservation?"
        description="The room becomes available again immediately. This can't be undone."
        confirmLabel="Cancel reservation"
      />
    </form>
  );
}

export function ModifyForm({ action, defaults, today }: { action: Action; defaults: { checkIn: string; checkOut: string; guests: number }; today: string }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-3">
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Check-in" name="checkIn" type="date" min={today} defaultValue={defaults.checkIn} error={state.fieldErrors?.checkIn} />
        <Field label="Check-out" name="checkOut" type="date" min={today} defaultValue={defaults.checkOut} error={state.fieldErrors?.checkOut} />
        <Field label="Guests" name="guests" type="number" min={1} max={50} defaultValue={String(defaults.guests)} error={state.fieldErrors?.guests} />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Updating…" : "Update dates"}
      </Button>
      <p className="text-xs text-muted">The price is recalculated. The guest may be moved to another room of the same type.</p>
    </form>
  );
}

export function ResendButton({ action }: { action: (s: ActionState) => Promise<ActionState> }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-2">
      <Result state={state} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Sending…" : "Resend confirmation email"}
      </Button>
    </form>
  );
}

export function NotesForm({ action, value }: { action: Action; value: string }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-2">
      <Result state={state} />
      <label htmlFor="specialRequests" className="block text-sm font-medium">Special requests</label>
      <textarea id="specialRequests" name="specialRequests" defaultValue={value} maxLength={2000} rows={3} className="block w-full rounded-lg border border-border px-3 py-2 text-sm" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Save</Button>
    </form>
  );
}
