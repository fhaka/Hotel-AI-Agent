"use client";

import { useActionState, useState } from "react";
import type { ActionState, AvailabilityResult } from "@/app/dashboard/reservations/actions";
import { useStepAction } from "@/components/onboarding/use-step-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { TextAreaField } from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
}

export function NewReservation({
  searchAction,
  createAction,
  today,
  emailConfigured,
}: {
  searchAction: (s: AvailabilityResult, fd: FormData) => Promise<AvailabilityResult>;
  createAction: (s: ActionState, fd: FormData) => Promise<ActionState>;
  today: string;
  emailConfigured: boolean;
}) {
  const [search, searchDispatch, searching] = useActionState(searchAction, { status: "idle" });
  const { state: created, pending: creating, dispatch: createDispatch, onSubmit } = useStepAction(createAction);
  const [selected, setSelected] = useState<string | null>(null);
  // One key per booking attempt, created in the browser when a room type is
  // chosen (never during render, so server and client markup agree). Double
  // clicks and retries reuse it, so they can't book twice.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const option = search.options?.find((o) => o.roomTypeId === selected);
  const errors = created.fieldErrors ?? {};

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold">1. Dates and guests</h2>
        <form action={(fd) => { setSelected(null); searchDispatch(fd); }} className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-start">
          <Field label="Check-in" name="checkIn" type="date" min={today} required error={search.fieldErrors?.checkIn} />
          <Field label="Check-out" name="checkOut" type="date" min={today} required error={search.fieldErrors?.checkOut} />
          <Field label="Guests" name="guests" type="number" min={1} max={50} defaultValue="2" required error={search.fieldErrors?.guests} />
          <Button type="submit" className="sm:mt-7" disabled={searching}>
            {searching ? "Checking…" : "Check availability"}
          </Button>
        </form>
        {search.message ? <div className="mt-4"><Alert tone="danger">{search.message}</Alert></div> : null}
      </Card>

      {search.status === "success" && search.stay ? (
        <Card className="p-6">
          <h2 className="mb-4 text-base font-semibold">
            2. Room type · {search.stay.checkIn} → {search.stay.checkOut}, {search.stay.guests} guest{search.stay.guests === 1 ? "" : "s"}
          </h2>
          {search.options?.length ? (
            <ul className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Room type">
              {search.options.map((o) => {
                const soldOut = o.availableRooms < 1;
                return (
                  <li key={o.roomTypeId}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected === o.roomTypeId}
                      disabled={soldOut}
                      onClick={() => {
                        setSelected(o.roomTypeId);
                        setIdempotencyKey((key) => key ?? crypto.randomUUID());
                      }}
                      className={cn(
                        "w-full rounded-lg border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50",
                        selected === o.roomTypeId ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-border hover:bg-canvas",
                      )}
                    >
                      <span className="block font-medium">{o.name}</span>
                      <span className="block text-sm text-muted">
                        {soldOut ? "Sold out" : `${o.availableRooms} free`} · up to {o.maximumGuests} guests
                      </span>
                      <span className="mt-2 block text-lg font-semibold">
                        {money(o.totalPriceCents, o.currency)}
                        <span className="text-sm font-normal text-muted"> for {o.nights} night{o.nights === 1 ? "" : "s"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Alert tone="warning">No room types fit this many guests.</Alert>
          )}
        </Card>
      ) : null}

      {option && search.stay && idempotencyKey ? (
        <Card className="p-6">
          <h2 className="mb-4 text-base font-semibold">3. Guest details</h2>
          <form action={createDispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
            {created.message ? <Alert tone="danger">{created.message}</Alert> : null}
            <input type="hidden" name="checkIn" value={search.stay.checkIn} />
            <input type="hidden" name="checkOut" value={search.stay.checkOut} />
            <input type="hidden" name="guests" value={search.stay.guests} />
            <input type="hidden" name="roomTypeId" value={option.roomTypeId} />
            <input type="hidden" name="roomId" value="" />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" name="fullName" required error={errors["guest.fullName"]} />
              <Field label="Email" name="email" type="email" error={errors["guest.email"]} hint="Needed for the confirmation email." />
              <Field label="Phone" name="phone" type="tel" error={errors["guest.phone"]} />
              <Field label="Preferred language (e.g. en, de)" name="preferredLanguage" maxLength={5} error={errors["guest.preferredLanguage"]} />
            </div>
            <TextAreaField label="Special requests" name="specialRequests" rows={2} error={errors.specialRequests} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="sendConfirmation" defaultChecked={emailConfigured} disabled={!emailConfigured} className="h-4 w-4 accent-brand-600" />
              Email a confirmation to the guest
              {!emailConfigured ? <span className="text-muted">(email sending is not configured)</span> : null}
            </label>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <p className="text-sm">
                <span className="font-medium">{option.name}</span> · {money(option.totalPriceCents, option.currency)}
              </p>
              <Button type="submit" disabled={creating}>
                {creating ? "Booking…" : "Create reservation"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
