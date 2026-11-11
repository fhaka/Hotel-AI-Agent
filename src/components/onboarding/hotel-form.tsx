"use client";

import type { StepFormState } from "@/app/onboarding/actions";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FormSection, SelectField, TextAreaField } from "@/components/ui/form-controls";
import { CURRENCIES } from "@/lib/onboarding/reference-data";
import { RemoveRowButton, RepeatableRows } from "./repeatable-rows";
import { FormError, StepActions } from "./step-actions";
import { useStepAction } from "./use-step-action";

export type RoomTypeDefaults = {
  name: string;
  description: string;
  maximumGuests: string;
  bedConfiguration: string;
  amenities: string;
  price: string;
  roomNumbers: string;
};

export type HotelDefaults = {
  checkInTime: string;
  checkOutTime: string;
  currency: string;
  cancellation: string;
  breakfast: string;
  parking: string;
  wifi: string;
  pets: string;
  extraServices: string;
  roomTypes: RoomTypeDefaults[];
};

const emptyRoomType: RoomTypeDefaults = {
  name: "",
  description: "",
  maximumGuests: "2",
  bedConfiguration: "",
  amenities: "",
  price: "",
  roomNumbers: "",
};

export function HotelForm({
  action,
  defaults,
  backHref,
  roomsLocked,
  submitLabel = "Save & continue",
}: {
  action: (state: StepFormState, formData: FormData) => Promise<StepFormState>;
  defaults: HotelDefaults;
  backHref?: string;
  roomsLocked: boolean;
  submitLabel?: string;
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-8" noValidate>
      <FormError message={state.message} />

      <FormSection title="Stay details">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Check-in from" name="checkInTime" type="time" required defaultValue={defaults.checkInTime} error={errors.checkInTime} />
          <Field label="Check-out by" name="checkOutTime" type="time" required defaultValue={defaults.checkOutTime} error={errors.checkOutTime} />
          <SelectField
            label="Currency"
            name="currency"
            defaultValue={defaults.currency}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            error={errors.currency}
          />
        </div>
      </FormSection>

      <FormSection title="Guest information" description="Agents answer guest questions from exactly what you write here.">
        <TextAreaField label="Cancellation policy" name="cancellation" defaultValue={defaults.cancellation} error={errors["policies.cancellation"]} hint="e.g. Free cancellation until 48 hours before arrival; after that the first night is charged." />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextAreaField label="Breakfast" name="breakfast" defaultValue={defaults.breakfast} error={errors["policies.breakfast"]} />
          <TextAreaField label="Parking" name="parking" defaultValue={defaults.parking} error={errors["policies.parking"]} />
          <TextAreaField label="Wi-Fi" name="wifi" defaultValue={defaults.wifi} error={errors["policies.wifi"]} hint="Don't enter the Wi-Fi password here." />
          <TextAreaField label="Pets" name="pets" defaultValue={defaults.pets} error={errors["policies.pets"]} />
        </div>
        <TextAreaField label="Extra services" name="extraServices" defaultValue={defaults.extraServices} error={errors["policies.extra_services"]} hint="Spa, transfers, tours, late check-out…" />
      </FormSection>

      <FormSection
        title="Room types and inventory"
        description="The reservation assistant checks availability against these rooms. Seasonal prices can be added later from the Rooms page."
      >
        {roomsLocked ? (
          <Alert tone="warning">
            You already have reservations, so rooms can no longer be replaced from setup. Manage them from the Rooms page.
          </Alert>
        ) : null}
        {errors.roomTypes ? <p className="text-sm text-danger-700">{errors.roomTypes}</p> : null}
        <RepeatableRows
          initial={defaults.roomTypes}
          empty={emptyRoomType}
          max={50}
          addLabel="Add room type"
          renderRow={(row, i, remove) => (
            <Card className="space-y-4 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Room type" name="room_name" id={`room_name_${i}`} defaultValue={row.name} placeholder="e.g. Double Room with Sea View" error={errors[`roomTypes.${i}.name`]} />
                <Field label="Bed configuration" name="room_beds" id={`room_beds_${i}`} defaultValue={row.bedConfiguration} placeholder="e.g. 1 queen bed" error={errors[`roomTypes.${i}.bedConfiguration`]} />
              </div>
              <TextAreaField label="Description" name="room_description" id={`room_description_${i}`} rows={2} defaultValue={row.description} error={errors[`roomTypes.${i}.description`]} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Max guests" name="room_max_guests" id={`room_max_guests_${i}`} type="number" min={1} max={50} defaultValue={row.maximumGuests} error={errors[`roomTypes.${i}.maximumGuests`]} />
                <Field label="Price per night" name="room_price" id={`room_price_${i}`} inputMode="decimal" defaultValue={row.price} placeholder="120.00" error={errors[`roomTypes.${i}.price`]} />
                <Field label="Room numbers" name="room_numbers" id={`room_numbers_${i}`} defaultValue={row.roomNumbers} placeholder="101-105, 201" error={errors[`roomTypes.${i}.roomNumbers`]} hint="Ranges allowed." />
              </div>
              <Field label="Amenities" name="room_amenities" id={`room_amenities_${i}`} defaultValue={row.amenities} placeholder="Air conditioning, Balcony, Minibar" error={errors[`roomTypes.${i}.amenities`]} hint="Comma-separated." />
              <RemoveRowButton onClick={remove} label="Remove room type" />
            </Card>
          )}
        />
      </FormSection>

      <StepActions pending={pending} submitLabel={submitLabel} backHref={backHref} />
    </form>
  );
}
