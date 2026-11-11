import type { Industry } from "./reference-data";

export type OnboardingStep = "company" | "operations" | "hotel" | "review";

export const STEP_LABELS: Record<OnboardingStep, string> = {
  company: "Company",
  operations: "Operations",
  hotel: "Hotel & rooms",
  review: "Review",
};

/** Steps for an industry, in order. Only hotels have the hotel step. */
export function stepsFor(industry: Industry): OnboardingStep[] {
  return industry === "hotel" ? ["company", "operations", "hotel", "review"] : ["company", "operations", "review"];
}

export function nextStep(industry: Industry, current: OnboardingStep): OnboardingStep {
  const steps = stepsFor(industry);
  const i = steps.indexOf(current);
  return steps[Math.min(i + 1, steps.length - 1)];
}

/** First step that has not been completed yet (review when all are done). */
export function resumeStep(industry: Industry, completed: readonly string[]): OnboardingStep {
  return stepsFor(industry).find((s) => s !== "review" && !completed.includes(s)) ?? "review";
}

export function readCompletedSteps(state: unknown): string[] {
  if (state && typeof state === "object" && Array.isArray((state as { completed_steps?: unknown }).completed_steps)) {
    return (state as { completed_steps: unknown[] }).completed_steps.filter((s): s is string => typeof s === "string");
  }
  return [];
}

export function stepPath(businessId: string, step: OnboardingStep): string {
  return `/onboarding/${businessId}/${step}`;
}
