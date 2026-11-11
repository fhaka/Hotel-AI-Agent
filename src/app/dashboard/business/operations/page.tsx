import type { Metadata } from "next";
import { saveOperations } from "@/app/onboarding/actions";
import { BusinessSettingsShell } from "@/components/business/business-settings-shell";
import { OperationsForm } from "@/components/onboarding/operations-form";
import { operationsDefaults } from "@/lib/onboarding/defaults";

export const metadata: Metadata = { title: "Hours, policies & FAQs" };

export default function BusinessOperationsPage({ searchParams }: PageProps<"/dashboard/business/operations">) {
  return (
    <BusinessSettingsShell tab="operations" searchParams={searchParams}>
      {(ctx) => (
        <OperationsForm
          action={saveOperations.bind(null, ctx.business.id, "/dashboard/business/operations")}
          defaults={operationsDefaults(ctx)}
          isHotel={ctx.business.industry === "hotel"}
          submitLabel="Save changes"
        />
      )}
    </BusinessSettingsShell>
  );
}
