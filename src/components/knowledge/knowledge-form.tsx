"use client";

import { useState } from "react";
import type { KnowledgeFormState } from "@/app/dashboard/knowledge/actions";
import { useStepAction } from "@/components/onboarding/use-step-action";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField, TextAreaField } from "@/components/ui/form-controls";
import { KNOWLEDGE_CATEGORIES, categoryInfo } from "@/lib/knowledge/categories";

const MAX = 20000;

export function KnowledgeForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (state: KnowledgeFormState, formData: FormData) => Promise<KnowledgeFormState>;
  defaults: { category: string; title: string; content: string };
  submitLabel: string;
}) {
  const { state, pending, dispatch, onSubmit } = useStepAction(action);
  const [category, setCategory] = useState(defaults.category);
  const [length, setLength] = useState(defaults.content.length);
  const info = categoryInfo(category);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={dispatch} onSubmit={onSubmit} className="space-y-5" noValidate>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <SelectField
        label="Category"
        name="category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        options={KNOWLEDGE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
        error={errors.category}
        hint={info.hint}
      />
      <Field label={info.titleLabel} name="title" defaultValue={defaults.title} maxLength={200} error={errors.title} />
      <div>
        <TextAreaField
          label={info.contentLabel}
          name="content"
          rows={8}
          defaultValue={defaults.content}
          maxLength={MAX}
          onChange={(e) => setLength(e.target.value.length)}
          error={errors.content}
          hint="Write it the way you'd want it explained to a customer. Agents will only state what is written here."
        />
        <p className="mt-1 text-right text-xs text-subtle" aria-live="polite">
          {length.toLocaleString("en")} / {MAX.toLocaleString("en")}
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-5">
        <ButtonLink href="/dashboard/knowledge" variant="ghost">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
