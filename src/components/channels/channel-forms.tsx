"use client";

import { useActionState, useState } from "react";
import type { ChannelState } from "@/app/dashboard/channels/actions";
import { useStepAction } from "@/components/onboarding/use-step-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { Field } from "@/components/ui/field";
import { SelectField, TextAreaField } from "@/components/ui/form-controls";

type Action = (s: ChannelState, fd: FormData) => Promise<ChannelState>;

function Result({ state }: { state: ChannelState }) {
  return state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null;
}

function EnabledToggle({ defaultChecked, label, disabled }: { defaultChecked: boolean; label: string; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" name="enabled" defaultChecked={defaultChecked} disabled={disabled} className="h-4 w-4 accent-brand-600" />
      {label}
    </label>
  );
}

export function WidgetForm({ action, defaults, readOnly }: { action: Action; defaults: { enabled: boolean; origins: string; accentColor: string }; readOnly: boolean }) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const e = state.fieldErrors ?? {};
  const originError = Object.entries(e).find(([k]) => k.startsWith("allowed_origins"))?.[1];
  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
      <Result state={state} />
      <fieldset disabled={readOnly} className="space-y-4">
        <EnabledToggle defaultChecked={defaults.enabled} label="Show the chat on my website" />
        <TextAreaField
          label="Websites where the chat may appear"
          name="origins"
          rows={2}
          defaultValue={defaults.origins}
          error={originError}
          hint="One per line, e.g. https://www.yourhotel.com. Browsers block the chat on any other site."
        />
        <Field label="Brand colour (optional)" name="accentColor" defaultValue={defaults.accentColor} placeholder="#1f57d6" error={e.accent_color} className="max-w-xs" />
      </fieldset>
      {readOnly ? null : <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save widget"}</Button>}
    </form>
  );
}

export function EmbedCode({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-xs text-white">{snippet}</pre>
      <Button type="button" size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(snippet).then(() => setCopied(true))}>
        {copied ? "Copied" : "Copy embed code"}
      </Button>
    </div>
  );
}

export function RegenerateKeyForm({ action }: { action: (s: ChannelState) => Promise<ChannelState> }) {
  const [state, dispatch] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="space-y-2">
      <Result state={state} />
      <ConfirmSubmit
        label="Regenerate key"
        title="Create a new widget key?"
        description="The chat on your website stops working until you replace the embed code with the new one."
        confirmLabel="Regenerate"
      />
    </form>
  );
}

export function VoiceForm({
  action,
  defaults,
  languages,
  readOnly,
}: {
  action: Action;
  defaults: { enabled: boolean; language: string; handoffPhone: string };
  languages: { value: string; label: string }[];
  readOnly: boolean;
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const e = state.fieldErrors ?? {};
  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
      <Result state={state} />
      <fieldset disabled={readOnly} className="space-y-4">
        <EnabledToggle defaultChecked={defaults.enabled} label="Answer calls with the AI phone assistant" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Call language" name="language" defaultValue={defaults.language} options={languages} error={e.language} hint="Languages the phone system can both understand and speak." />
          <Field label="Transfer to staff (optional)" name="handoffPhone" type="tel" defaultValue={defaults.handoffPhone} placeholder="+355691234567" error={e.handoff_phone} hint="When a caller needs a person, the call is forwarded here." />
        </div>
      </fieldset>
      {readOnly ? null : <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save phone settings"}</Button>}
    </form>
  );
}

export function WhatsappForm({ action, enabled, readOnly }: { action: Action; enabled: boolean; readOnly: boolean }) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
      <Result state={state} />
      <fieldset disabled={readOnly}>
        <EnabledToggle defaultChecked={enabled} label="Answer WhatsApp messages with the AI reservation assistant" />
      </fieldset>
      {readOnly ? null : <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save WhatsApp settings"}</Button>}
    </form>
  );
}
