"use client";

import { useActionState } from "react";
import type { SimpleState } from "@/app/dashboard/team/actions";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";

type Action = (state: SimpleState, formData: FormData) => Promise<SimpleState>;

export function RoleSelect({ userId, role, roles, action }: { userId: string; role: string; roles: string[]; action: Action }) {
  const [state, dispatch, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={role}
        aria-label="Role"
        className="h-8 rounded-lg border border-border bg-surface px-2 text-sm"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r[0].toUpperCase() + r.slice(1)}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state.message ? (
        <span role="status" className={state.status === "error" ? "text-xs text-danger-700" : "text-xs text-success-700"}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function RemoveMember({
  userId,
  label,
  isSelf,
  action,
}: {
  userId: string;
  label: string;
  isSelf: boolean;
  action: Action;
}) {
  const [state, dispatch] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <ConfirmSubmit
        label={isSelf ? "Leave" : "Remove"}
        title={isSelf ? "Leave this workspace?" : `Remove ${label}?`}
        description={
          isSelf
            ? "You will lose access immediately. An owner or admin would need to invite you again."
            : "They will lose access to this workspace immediately. Their past activity stays in the audit log."
        }
        confirmLabel={isSelf ? "Leave workspace" : "Remove member"}
      />
      {state.status === "error" ? <span className="text-xs text-danger-700">{state.message}</span> : null}
    </form>
  );
}

export function RevokeInvitation({ invitationId, email, action }: { invitationId: string; email: string; action: Action }) {
  const [state, dispatch] = useActionState(action, { status: "idle" });
  return (
    <form action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      <ConfirmSubmit
        label="Revoke"
        title={`Revoke the invitation for ${email}?`}
        description="The invitation link will stop working immediately."
        confirmLabel="Revoke invitation"
      />
      {state.status === "error" ? <span className="text-xs text-danger-700">{state.message}</span> : null}
    </form>
  );
}
