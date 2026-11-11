import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getOnboardingContext, type OnboardingContext } from "@/lib/onboarding/queries";
import type { OnboardingStep } from "@/lib/onboarding/steps";
import { Stepper } from "./stepper";

/**
 * Loads and authorizes one onboarding step for the business in the URL, then
 * renders the stepper and the step body. Non-members get a 404 (from the
 * loader); members without owner/admin role get an access-denied card.
 */
export async function StepShell({
  params,
  step,
  title,
  description,
  children,
}: {
  params: Promise<{ businessId: string }>;
  step: OnboardingStep;
  title: string;
  description?: string;
  children: (ctx: OnboardingContext) => ReactNode | Promise<ReactNode>;
}) {
  const { businessId } = await params;
  const user = await requireUser(`/onboarding/${businessId}/${step}`);
  const ctx = await getOnboardingContext(user, businessId);

  if (ctx.access === "denied") {
    return (
      <Card className="space-y-4 p-8">
        <Alert tone="warning" title="Only owners and admins can change the workspace setup">
          Your role in this workspace is {ctx.role}. Ask an owner if something needs to change.
        </Alert>
        <ButtonLink href="/dashboard" variant="secondary">
          Back to dashboard
        </ButtonLink>
      </Card>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-brand-600">{ctx.business.name}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-2 text-sm text-muted">{description}</p> : null}
      <div className="mt-6">
        <Stepper businessId={businessId} industry={ctx.business.industry} current={step} completed={ctx.completedSteps} />
      </div>
      <Card className="p-6 sm:p-8">{await children(ctx)}</Card>
    </div>
  );
}
