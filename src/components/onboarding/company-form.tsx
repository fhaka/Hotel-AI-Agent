"use client";

import { useEffect, useRef } from "react";
import type { StepFormState } from "@/app/onboarding/actions";
import { Field } from "@/components/ui/field";
import { FormSection, SelectField, TextAreaField } from "@/components/ui/form-controls";
import { INDUSTRIES, LANGUAGES } from "@/lib/onboarding/reference-data";
import { FormError, StepActions } from "./step-actions";
import { useStepAction } from "./use-step-action";

export type CompanyDefaults = {
  name: string;
  industry: string;
  description: string;
  contactEmail: string;
  phone: string;
  website: string;
  country: string;
  city: string;
  address: string;
  timezone: string;
  defaultLanguage: string;
  supportedLanguages: string[];
};

export function CompanyForm({
  mode,
  action,
  defaults,
  countries,
  timeZones,
}: {
  mode: "create" | "edit";
  action: (state: StepFormState, formData: FormData) => Promise<StepFormState>;
  defaults: CompanyDefaults;
  countries: { code: string; label: string }[];
  timeZones: string[];
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const errors = state.fieldErrors ?? {};
  const tzRef = useRef<HTMLSelectElement>(null);

  // Pre-select the browser's time zone for new workspaces (after hydration,
  // so server and client markup match).
  useEffect(() => {
    if (mode !== "create" || !tzRef.current) return;
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZones.includes(browserTz)) tzRef.current.value = browserTz;
  }, [mode, timeZones]);

  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-8" noValidate>
      <FormError message={state.message} />

      <FormSection title="Your business" description="This is how your AI agents will introduce your business.">
        <Field label="Business name" name="name" required defaultValue={defaults.name} error={errors.name} />
        {mode === "create" ? (
          <SelectField
            label="Industry"
            name="industry"
            required
            defaultValue={defaults.industry}
            placeholder="Choose your industry"
            options={INDUSTRIES.map((i) => ({ value: i.value, label: i.note ? `${i.label} — ${i.note}` : i.label }))}
            error={errors.industry}
            hint="This decides which setup steps and agents apply. It can't be changed later."
          />
        ) : (
          <p className="text-sm text-muted">
            Industry: <span className="font-medium text-ink">{INDUSTRIES.find((i) => i.value === defaults.industry)?.label}</span>
          </p>
        )}
        <TextAreaField
          label="Description"
          name="description"
          rows={4}
          defaultValue={defaults.description}
          error={errors.description}
          hint="A few sentences about what makes your business special."
        />
      </FormSection>

      <FormSection title="Contact details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact email" name="contactEmail" type="email" defaultValue={defaults.contactEmail} error={errors.contactEmail} />
          <Field label="Phone" name="phone" type="tel" defaultValue={defaults.phone} error={errors.phone} />
        </div>
        <Field label="Website" name="website" defaultValue={defaults.website} placeholder="www.example.com" error={errors.website} />
      </FormSection>

      <FormSection title="Location">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Country"
            name="country"
            required
            defaultValue={defaults.country}
            placeholder="Choose a country"
            options={countries.map((c) => ({ value: c.code, label: c.label }))}
            error={errors.country}
          />
          <Field label="City" name="city" defaultValue={defaults.city} error={errors.city} />
        </div>
        <Field label="Address" name="address" defaultValue={defaults.address} error={errors.address} />
        <SelectField
          ref={tzRef}
          label="Time zone"
          name="timezone"
          required
          defaultValue={defaults.timezone}
          options={timeZones.map((tz) => ({ value: tz, label: tz.replaceAll("_", " ") }))}
          error={errors.timezone}
          hint="Used for opening hours, check-in times and when your trial ends."
        />
      </FormSection>

      <FormSection title="Languages" description="Your agents will reply in the customer's language when it is supported.">
        <SelectField
          label="Main language"
          name="defaultLanguage"
          required
          defaultValue={defaults.defaultLanguage}
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          error={errors.defaultLanguage}
        />
        <fieldset>
          <legend className="text-sm font-medium">Other languages your customers speak</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {LANGUAGES.map((l) => (
              <label key={l.code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="supportedLanguages"
                  value={l.code}
                  defaultChecked={defaults.supportedLanguages.includes(l.code)}
                  className="h-4 w-4 rounded border-border accent-brand-600"
                />
                {l.label}
              </label>
            ))}
          </div>
          {errors.supportedLanguages ? <p className="mt-1 text-sm text-danger-700">{errors.supportedLanguages}</p> : null}
        </fieldset>
      </FormSection>

      {mode === "create" ? (
        <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-900">
          Creating the workspace starts your <strong>7-day free trial</strong>. No payment card is needed. You can
          finish the remaining steps later.
        </p>
      ) : null}

      <StepActions pending={pending} submitLabel={mode === "create" ? "Create workspace & continue" : "Save & continue"} />
    </form>
  );
}
