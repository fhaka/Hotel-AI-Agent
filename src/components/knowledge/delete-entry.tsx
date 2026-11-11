"use client";

import { useActionState } from "react";
import type { KnowledgeFormState } from "@/app/dashboard/knowledge/actions";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";

export function DeleteEntryForm({
  entryId,
  title,
  action,
}: {
  entryId: string;
  title: string;
  action: (state: KnowledgeFormState, formData: FormData) => Promise<KnowledgeFormState>;
}) {
  const [state, dispatch] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="entryId" value={entryId} />
      <ConfirmSubmit
        label="Delete"
        title="Delete this entry?"
        description={`“${title}” will be removed and your agents will no longer use it. This can't be undone.`}
        confirmLabel="Delete entry"
      />
      {state.message ? <span className="text-xs text-danger-700">{state.message}</span> : null}
    </form>
  );
}
