"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "./button";

/**
 * A submit button that asks for confirmation in a native <dialog> before
 * submitting its form. Used for destructive actions (remove member, revoke).
 */
export function ConfirmSubmit({
  label,
  title,
  description,
  confirmLabel,
  variant = "danger",
}: {
  label: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "danger" | "secondary";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button type="button" variant={variant === "danger" ? "ghost" : "secondary"} size="sm" onClick={() => dialog.current?.showModal()}>
        {label}
      </Button>
      <dialog ref={dialog} className="m-auto w-full max-w-md rounded-xl border border-border p-6 shadow-xl backdrop:bg-ink/40">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} onClick={() => dialog.current?.close()}>
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
