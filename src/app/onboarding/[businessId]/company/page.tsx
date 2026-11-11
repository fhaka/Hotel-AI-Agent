import type { Metadata } from "next";
import { updateCompany } from "@/app/onboarding/actions";
import { CompanyForm } from "@/components/onboarding/company-form";
import { StepShell } from "@/components/onboarding/step-shell";
import { companyDefaults } from "@/lib/onboarding/defaults";
import { countryOptions, timeZoneOptions } from "@/lib/onboarding/reference-data";

export const metadata: Metadata = { title: "Company details" };

export default function CompanyStepPage({ params }: PageProps<"/onboarding/[businessId]/company">) {
  return (
    <StepShell params={params} step="company" title="Company details">
      {(ctx) => (
        <CompanyForm
          mode="edit"
          action={updateCompany.bind(null, ctx.business.id, null)}
          defaults={companyDefaults(ctx.business)}
          countries={countryOptions()}
          timeZones={timeZoneOptions()}
        />
      )}
    </StepShell>
  );
}
