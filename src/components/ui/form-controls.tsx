import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-lg border bg-surface px-3 text-sm text-ink shadow-sm placeholder:text-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";

function Wrapper({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
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

function a11y(id: string, error?: string, hint?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  };
}

export function TextAreaField({
  label,
  error,
  hint,
  className,
  id,
  name,
  rows = 3,
  ...props
}: ComponentProps<"textarea"> & { label: string; name: string; error?: string; hint?: string }) {
  const fieldId = id ?? `field-${name}`;
  return (
    <Wrapper id={fieldId} label={label} error={error} hint={hint} className={className}>
      <textarea
        name={name}
        rows={rows}
        className={cn(control, "py-2", error ? "border-danger-600" : "border-border")}
        {...a11y(fieldId, error, hint)}
        {...props}
      />
    </Wrapper>
  );
}

export function SelectField({
  label,
  error,
  hint,
  className,
  id,
  name,
  options,
  placeholder,
  ...props
}: ComponentProps<"select"> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const fieldId = id ?? `field-${name}`;
  return (
    <Wrapper id={fieldId} label={label} error={error} hint={hint} className={className}>
      <select
        name={name}
        className={cn(control, "h-10", error ? "border-danger-600" : "border-border")}
        {...a11y(fieldId, error, hint)}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrapper>
  );
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
