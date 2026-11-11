import type { Metadata } from "next";
import Link from "next/link";
import { createWorkspace } from "@/app/onboarding/actions";
import { CompanyForm } from "@/components/onboarding/company-form";
import { Stepper } from "@/components/onboarding/stepper";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { NEW_COMPANY_DEFAULTS } from "@/lib/onboarding/defaults";
import { countryOptions, timeZoneOptions } from "@/lib/onboarding/reference-data";
import { readCompletedSteps, resumeStep, stepPath } from "@/lib/onboarding/steps";
import { listMyWorkspaces } from "@/lib/workspaces/queries";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const workspaces = await listMyWorkspaces(user);
  const unfinished = workspaces.filter(
    (w) => !w.onboardingCompleted && (w.role === "owner" || w.role === "admin"),
  );

  return (
    <div>
      {unfinished.length ? (
        <Card className="mb-8 space-y-2 border-brand-200 bg-brand-50 p-5">
          <p className="text-sm font-medium text-brand-900">You have a workspace that isn&apos;t fully set up yet:</p>
          <ul className="space-y-1">
            {unfinished.map((w) => (
              <li key={w.businessId}>
                <Link
                  href={stepPath(w.businessId, resumeStep(w.industry, readCompletedSteps(w.onboardingState)))}
                  className="text-sm font-medium text-brand-700 underline"
                >
                  Continue setting up {w.name} →
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <h1 className="text-2xl font-semibold tracking-tight">
        {workspaces.length ? "Create another workspace" : "Set up your business workspace"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        Each business gets its own private workspace with its own agents, knowledge and data.
      </p>
      <div className="mt-6">
        <Stepper businessId={null} industry={null} current="company" completed={[]} />
      </div>
      <Card className="p-6 sm:p-8">
        <CompanyForm
          mode="create"
          action={createWorkspace}
          defaults={NEW_COMPANY_DEFAULTS}
          countries={countryOptions()}
          timeZones={timeZoneOptions()}
        />
      </Card>
    </div>
  );
}
