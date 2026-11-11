"use client";

import { useState } from "react";
import type { StepFormState } from "@/app/onboarding/actions";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FormSection, TextAreaField } from "@/components/ui/form-controls";
import { WEEKDAYS, type WeekdayKey } from "@/lib/onboarding/reference-data";
import type { DayHours } from "@/lib/onboarding/schemas";
import { RemoveRowButton, RepeatableRows } from "./repeatable-rows";
import { FormError, StepActions } from "./step-actions";
import { useStepAction } from "./use-step-action";

export type OperationsDefaults = {
  openingHours: Partial<Record<WeekdayKey, DayHours>>;
  policyGeneral: string;
  contactInstructions: string;
  services: { title: string; content: string }[];
  faqs: { question: string; answer: string }[];
};

export function OperationsForm({
  action,
  defaults,
  isHotel,
  backHref,
  submitLabel = "Save & continue",
}: {
  action: (state: StepFormState, formData: FormData) => Promise<StepFormState>;
  defaults: OperationsDefaults;
  isHotel: boolean;
  backHref?: string;
  submitLabel?: string;
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-8" noValidate>
      <FormError message={state.message} />

      <FormSection
        title={isHotel ? "Reception hours" : "Opening hours"}
        description={
          isHotel
            ? "When guests can reach your front desk. Agents use this to set expectations for a human reply."
            : "Agents use these hours to answer “are you open?” questions."
        }
      >
        <div className="divide-y divide-border rounded-lg border border-border">
          {WEEKDAYS.map((d) => (
            <DayRow key={d.key} day={d.key} label={d.label} initial={defaults.openingHours[d.key]} errors={errors} />
          ))}
        </div>
      </FormSection>

      <FormSection title="Policies and contact">
        <TextAreaField
          label="Business policies"
          name="policyGeneral"
          rows={4}
          defaultValue={defaults.policyGeneral}
          error={errors["policies.general"]}
          hint="House rules, payment methods, age restrictions… Agents will quote these accurately and never invent others."
        />
        <TextAreaField
          label="Contact instructions"
          name="contactInstructions"
          rows={3}
          defaultValue={defaults.contactInstructions}
          error={errors["policies.contact_instructions"]}
          hint="How customers should reach a person, e.g. “Call +355… between 8:00 and 20:00 for urgent requests.”"
        />
      </FormSection>

      <FormSection title="Services" description="What you offer. Include prices only if you want agents to quote them.">
        <RepeatableRows
          initial={defaults.services}
          empty={{ title: "", content: "" }}
          max={50}
          addLabel="Add service"
          renderRow={(row, i, remove) => (
            <Card className="space-y-3 p-4">
              <Field
                label="Service"
                name="service_title"
                id={`service_title_${i}`}
                defaultValue={row.title}
                placeholder="e.g. Airport transfer"
                error={errors[`services.${i}.title`]}
              />
              <TextAreaField
                label="Details"
                name="service_content"
                id={`service_content_${i}`}
                rows={2}
                defaultValue={row.content}
                error={errors[`services.${i}.content`]}
              />
              <RemoveRowButton onClick={remove} label="Remove service" />
            </Card>
          )}
        />
      </FormSection>

      <FormSection title="Frequently asked questions" description="The questions customers ask you most often, with your answers.">
        <RepeatableRows
          initial={defaults.faqs}
          empty={{ question: "", answer: "" }}
          max={100}
          addLabel="Add question"
          renderRow={(row, i, remove) => (
            <Card className="space-y-3 p-4">
              <Field
                label="Question"
                name="faq_question"
                id={`faq_question_${i}`}
                defaultValue={row.question}
                error={errors[`faqs.${i}.question`]}
              />
              <TextAreaField
                label="Answer"
                name="faq_answer"
                id={`faq_answer_${i}`}
                rows={2}
                defaultValue={row.answer}
                error={errors[`faqs.${i}.answer`]}
              />
              <RemoveRowButton onClick={remove} label="Remove question" />
            </Card>
          )}
        />
      </FormSection>

      <StepActions pending={pending} submitLabel={submitLabel} backHref={backHref} />
    </form>
  );
}

function DayRow({
  day,
  label,
  initial,
  errors,
}: {
  day: WeekdayKey;
  label: string;
  initial?: DayHours;
  errors: Record<string, string>;
}) {
  const [mode, setMode] = useState<DayHours["mode"]>(initial?.mode ?? "hours");
  const opens = initial?.mode === "hours" ? initial.opens : "08:00";
  const closes = initial?.mode === "hours" ? initial.closes : "20:00";
  const error = errors[`openingHours.${day}.opens`] ?? errors[`openingHours.${day}.closes`];

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="w-28 text-sm font-medium">{label}</span>
      <select
        name={`hours_${day}_mode`}
        aria-label={`${label} status`}
        value={mode}
        onChange={(e) => setMode(e.target.value as DayHours["mode"])}
        className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
      >
        <option value="hours">Open</option>
        <option value="open_24h">Open 24 hours</option>
        <option value="closed">Closed</option>
      </select>
      {/* Time inputs stay in the DOM (hidden) so values survive toggling. */}
      <div className={mode === "hours" ? "flex items-center gap-2" : "hidden"}>
        <input
          type="time"
          name={`hours_${day}_opens`}
          aria-label={`${label} opens`}
          defaultValue={opens}
          className="h-9 rounded-lg border border-border px-2 text-sm"
        />
        <span className="text-sm text-muted">to</span>
        <input
          type="time"
          name={`hours_${day}_closes`}
          aria-label={`${label} closes`}
          defaultValue={closes}
          className="h-9 rounded-lg border border-border px-2 text-sm"
        />
      </div>
      {error ? <p className="w-full text-sm text-danger-700">{error}</p> : null}
    </div>
  );
}
