import type { Metadata } from "next";
import { updateCompany } from "@/app/onboarding/actions";
import { BusinessSettingsShell } from "@/components/business/business-settings-shell";
import { CompanyForm } from "@/components/onboarding/company-form";
import { companyDefaults } from "@/lib/onboarding/defaults";
import { countryOptions, timeZoneOptions } from "@/lib/onboarding/reference-data";

export const metadata: Metadata = { title: "Business profile" };

export default function BusinessProfilePage({ searchParams }: PageProps<"/dashboard/business">) {
  return (
    <BusinessSettingsShell tab="profile" searchParams={searchParams}>
      {(ctx) => (
        <CompanyForm
          mode="edit"
          action={updateCompany.bind(null, ctx.business.id, "/dashboard/business")}
          defaults={companyDefaults(ctx.business)}
          countries={countryOptions()}
          timeZones={timeZoneOptions()}
          submitLabel="Save changes"
        />
      )}
    </BusinessSettingsShell>
  );
}
