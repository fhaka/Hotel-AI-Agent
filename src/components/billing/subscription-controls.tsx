"use client";

import { useActionState } from "react";
import type { BillingActionState } from "@/app/dashboard/billing/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";

export function SubscriptionControls({
  cancelAction,
  portalAction,
  canCancel,
}: {
  cancelAction: (s: BillingActionState) => Promise<BillingActionState>;
  portalAction: () => Promise<void>;
  canCancel: boolean;
}) {
  const [state, dispatch] = useActionState(cancelAction, { status: "idle" });
  return (
    <div className="space-y-3">
      {state.message ? <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <form action={portalAction}>
          <Button type="submit" variant="secondary" size="sm">Manage payment details & invoices</Button>
        </form>
        {canCancel ? (
          <form action={dispatch}>
            <ConfirmSubmit
              label="Cancel subscription"
              title="Cancel your subscription?"
              description="You keep full access until the end of the current billing period. After that, AI agents stop; your data stays available and is not deleted."
              confirmLabel="Cancel at period end"
            />
          </form>
        ) : null}
      </div>
    </div>
  );
}
