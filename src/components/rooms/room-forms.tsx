"use client";

import { useActionState } from "react";
import type { RoomsState } from "@/app/dashboard/rooms/actions";
import { useStepAction } from "@/components/onboarding/use-step-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { Field } from "@/components/ui/field";
import { TextAreaField } from "@/components/ui/form-controls";

type Action = (s: RoomsState, fd: FormData) => Promise<RoomsState>;

function Result({ state }: { state: RoomsState }) {
  return state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null;
}

export function RoomTypeForm({
  action,
  defaults,
  submitLabel,
}: {
  action: Action;
  defaults: { name: string; description: string; maximumGuests: string; bedConfiguration: string; amenities: string; price: string; isActive: boolean };
  submitLabel: string;
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const e = state.fieldErrors ?? {};
  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
      <Result state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" defaultValue={defaults.name} error={e.name} />
        <Field label="Bed configuration" name="bedConfiguration" defaultValue={defaults.bedConfiguration} error={e.bedConfiguration} />
        <Field label="Max guests" name="maximumGuests" type="number" min={1} max={50} defaultValue={defaults.maximumGuests} error={e.maximumGuests} />
        <Field label="Base price per night" name="price" inputMode="decimal" defaultValue={defaults.price} error={e.price} />
      </div>
      <TextAreaField label="Description" name="description" rows={2} defaultValue={defaults.description} error={e.description} />
      <Field label="Amenities (comma-separated)" name="amenities" defaultValue={defaults.amenities} error={e.amenities} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={defaults.isActive} className="h-4 w-4 accent-brand-600" />
        Bookable (inactive room types are hidden from availability and the AI)
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}

export function AddRoomsForm({ action }: { action: Action }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-2">
      <Result state={state} />
      <div className="flex items-end gap-2">
        <Field label="Add room numbers" name="roomNumbers" placeholder="105, 106-108" error={state.fieldErrors?.roomNumbers} className="flex-1" />
        <Button type="submit" variant="secondary" disabled={pending}>Add</Button>
      </div>
    </form>
  );
}

export function RoomRow({
  roomId,
  roomNumber,
  status,
  statusAction,
  deleteAction,
}: {
  roomId: string;
  roomNumber: string;
  status: string;
  statusAction: Action;
  deleteAction: Action;
}) {
  const [s1, d1, p1] = useActionState(statusAction, { status: "idle" });
  const [s2, d2] = useActionState(deleteAction, { status: "idle" });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="font-medium">Room {roomNumber}</span>
      <div className="flex items-center gap-2">
        <form action={d1} className="flex items-center gap-2">
          <input type="hidden" name="roomId" value={roomId} />
          <select name="status" defaultValue={status} aria-label={`Status of room ${roomNumber}`} className="h-8 rounded-lg border border-border bg-surface px-2 text-sm">
            <option value="available">Available</option>
            <option value="out_of_service">Out of service</option>
            <option value="retired">Retired</option>
          </select>
          <Button type="submit" size="sm" variant="secondary" disabled={p1}>Save</Button>
        </form>
        <form action={d2}>
          <input type="hidden" name="roomId" value={roomId} />
          <ConfirmSubmit label="Delete" title={`Delete room ${roomNumber}?`} description="Rooms with reservations can't be deleted; mark them retired instead." confirmLabel="Delete room" />
        </form>
      </div>
      {s1.status === "error" || s2.status === "error" ? <p className="w-full text-xs text-danger-700">{s1.message ?? s2.message}</p> : null}
    </li>
  );
}

export function AddRateForm({ action }: { action: Action }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const e = state.fieldErrors ?? {};
  return (
    <form action={dispatch} className="space-y-3">
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Name (optional)" name="name" placeholder="Summer" error={e.name} />
        <Field label="First night" name="startsOn" type="date" error={e.startsOn} />
        <Field label="Until (exclusive)" name="endsOn" type="date" error={e.endsOn} />
        <Field label="Price per night" name="price" inputMode="decimal" error={e.price} />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Add seasonal rate</Button>
    </form>
  );
}

export function DeleteRateButton({ rateId, action }: { rateId: string; action: Action }) {
  const [state, dispatch] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="inline-flex items-center gap-2">
      <input type="hidden" name="rateId" value={rateId} />
      <ConfirmSubmit label="Delete" title="Delete this seasonal rate?" description="New quotes will use the base price for these dates. Existing reservations keep their price." confirmLabel="Delete rate" />
      {state.status === "error" ? <span className="text-xs text-danger-700">{state.message}</span> : null}
    </form>
  );
}
