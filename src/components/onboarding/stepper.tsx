import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Industry } from "@/lib/onboarding/reference-data";
import { STEP_LABELS, stepPath, stepsFor, type OnboardingStep } from "@/lib/onboarding/steps";

/** Progress indicator. Completed steps are links so owners can go back and edit. */
export function Stepper({
  businessId,
  industry,
  current,
  completed,
}: {
  businessId: string | null;
  industry: Industry | null;
  current: OnboardingStep;
  completed: readonly string[];
}) {
  const steps = industry ? stepsFor(industry) : (["company", "operations", "hotel", "review"] as OnboardingStep[]);
  return (
    <nav aria-label="Setup progress" className="mb-8">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {steps.map((step, i) => {
          const done = completed.includes(step);
          const isCurrent = step === current;
          const reachable = businessId && (done || step === "review" || completed.includes(steps[i - 1] ?? ""));
          const content = (
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1",
                isCurrent
                  ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                  : done
                    ? "border-success-700/30 bg-success-50 text-success-700"
                    : "border-border text-muted",
              )}
            >
              <span aria-hidden>{done && !isCurrent ? "✓" : i + 1}</span>
              {STEP_LABELS[step]}
            </span>
          );
          return (
            <li key={step} aria-current={isCurrent ? "step" : undefined}>
              {reachable && !isCurrent ? <Link href={stepPath(businessId, step)}>{content}</Link> : content}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
