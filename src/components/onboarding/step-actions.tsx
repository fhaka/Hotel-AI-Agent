import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";

export function FormError({ message }: { message?: string }) {
  return message ? <Alert tone="danger">{message}</Alert> : null;
}

export function StepActions({
  pending,
  submitLabel,
  backHref,
}: {
  pending: boolean;
  submitLabel: string;
  backHref?: string;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border pt-6">
      {backHref ? (
        <Link href={backHref} className={buttonClasses("ghost")}>
          ← Back
        </Link>
      ) : (
        <span />
      )}
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}
