import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Labelled text input with accessible error wiring. */
export function Field({
  label,
  name,
  error,
  hint,
  className,
  ...inputProps
}: ComponentProps<"input"> & { label: string; name: string; error?: string; hint?: string }) {
  const id = inputProps.id ?? `field-${name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "block h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink shadow-sm placeholder:text-subtle",
          "focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100",
          error ? "border-danger-600" : "border-border",
        )}
        {...inputProps}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
