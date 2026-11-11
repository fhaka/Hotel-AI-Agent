"use client";

import type { AgentFormState } from "@/app/dashboard/agents/actions";
import { useStepAction } from "@/components/onboarding/use-step-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormSection, SelectField, TextAreaField } from "@/components/ui/form-controls";
import { TONES, type AgentConfig } from "@/lib/agents/config";

export function AgentForm({
  action,
  defaults,
  canEnable,
  readOnly,
}: {
  action: (state: AgentFormState, formData: FormData) => Promise<AgentFormState>;
  defaults: { name: string; description: string; enabled: boolean; config: AgentConfig };
  canEnable: boolean;
  readOnly: boolean;
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-8" noValidate>
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      <fieldset disabled={readOnly} className="space-y-8">
        <FormSection title="Basics">
          <Field label="Name" name="name" defaultValue={defaults.name} error={errors.name} hint="Shown to customers, e.g. “Anna from Hotel Adriatik”." />
          <TextAreaField label="Internal description" name="description" rows={2} defaultValue={defaults.description} error={errors.description} />
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={defaults.enabled}
              disabled={!canEnable && !defaults.enabled}
              className="mt-1 h-4 w-4 accent-brand-600"
            />
            <span>
              <span className="block text-sm font-medium">Agent is on</span>
              <span className="block text-sm text-muted">
                {canEnable ? "When off, the agent will not answer in any channel." : "This agent is not available for your workspace yet."}
              </span>
            </span>
          </label>
        </FormSection>

        <FormSection title="Behaviour" description="Your preferences are added to the agent's instructions. Safety rules (never inventing prices or availability, never confirming a booking before it is saved) always apply.">
          <SelectField label="Tone" name="tone" defaultValue={defaults.config.tone} options={TONES.map((t) => ({ value: t.value, label: t.label }))} error={errors["config.tone"]} />
          <TextAreaField label="Greeting" name="greeting" rows={2} defaultValue={defaults.config.greeting} error={errors["config.greeting"]} hint="First message to a new visitor. Leave empty for an automatic greeting." />
          <TextAreaField label="When handing over to staff" name="escalationMessage" rows={2} defaultValue={defaults.config.escalation_message} error={errors["config.escalation_message"]} hint="What the agent says when a request needs a person, e.g. “Our reception will email you within 2 hours.”" />
          <TextAreaField label="Additional instructions" name="extraInstructions" rows={4} defaultValue={defaults.config.extra_instructions} error={errors["config.extra_instructions"]} hint="Anything else the agent should know or emphasise. Don't include passwords or private data." />
        </FormSection>
      </fieldset>
      {readOnly ? (
        <p className="text-sm text-muted">Only owners and admins can change agent settings.</p>
      ) : (
        <div className="flex justify-end border-t border-border pt-6">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save agent"}
          </Button>
        </div>
      )}
    </form>
  );
}
