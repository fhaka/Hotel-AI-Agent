"use client";

import { useActionState, useState } from "react";
import type { InviteState } from "@/app/dashboard/team/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/form-controls";

const ROLE_HELP: Record<string, string> = {
  admin: "Admin — manage the business, team (except owners/admins), agents and knowledge",
  manager: "Manager — edit knowledge, rooms and reservations",
  staff: "Staff — handle guests, reservations and conversations",
};

export function InviteForm({
  action,
  roles,
}: {
  action: (state: InviteState, formData: FormData) => Promise<InviteState>;
  roles: string[];
}) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      {state.status === "success" ? (
        <Alert tone={state.email === "sent" ? "success" : "warning"}>
          <p>{state.message}</p>
          {state.inviteUrl ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded bg-surface px-2 py-1 text-xs text-ink">{state.inviteUrl}</code>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(state.inviteUrl!).then(() => setCopied(true))}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          ) : null}
          <p className="mt-2 text-xs">The link works once, for 7 days, and only for an account with that email address.</p>
        </Alert>
      ) : null}
      {state.status === "error" && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <form action={dispatch} className="grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-start" noValidate>
        <Field label="Email address" name="email" type="email" required error={state.fieldErrors?.email} />
        <SelectField
          label="Role"
          name="role"
          defaultValue={roles.includes("staff") ? "staff" : roles[0]}
          options={roles.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))}
          error={state.fieldErrors?.role}
        />
        <Button type="submit" className="sm:mt-7" disabled={pending}>
          {pending ? "Inviting…" : "Send invitation"}
        </Button>
      </form>
      <ul className="space-y-1 text-xs text-muted">
        {roles.map((r) => (
          <li key={r}>{ROLE_HELP[r]}</li>
        ))}
      </ul>
    </div>
  );
}
