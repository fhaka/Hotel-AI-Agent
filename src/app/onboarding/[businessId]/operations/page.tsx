import type { Metadata } from "next";
import { saveOperations } from "@/app/onboarding/actions";
import { OperationsForm } from "@/components/onboarding/operations-form";
import { StepShell } from "@/components/onboarding/step-shell";
import { operationsDefaults } from "@/lib/onboarding/defaults";
import { stepPath } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "How you operate" };

export default function OperationsStepPage({ params }: PageProps<"/onboarding/[businessId]/operations">) {
  return (
    <StepShell
      params={params}
      step="operations"
      title="How you operate"
      description="Hours, policies, services and common questions. Everything here becomes knowledge your agents use."
    >
      {(ctx) => (
        <OperationsForm
          action={saveOperations.bind(null, ctx.business.id)}
          defaults={operationsDefaults(ctx)}
          isHotel={ctx.business.industry === "hotel"}
          backHref={stepPath(ctx.business.id, "company")}
        />
      )}
    </StepShell>
  );
}
