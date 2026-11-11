import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { saveHotel } from "@/app/onboarding/actions";
import { HotelForm } from "@/components/onboarding/hotel-form";
import { StepShell } from "@/components/onboarding/step-shell";
import { hotelDefaults } from "@/lib/onboarding/defaults";
import { stepPath } from "@/lib/onboarding/steps";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hotel & rooms" };

export default function HotelStepPage({ params }: PageProps<"/onboarding/[businessId]/hotel">) {
  return (
    <StepShell
      params={params}
      step="hotel"
      title="Hotel & rooms"
      description="Stay details, guest information and the rooms your reservation assistant can book."
    >
      {async (ctx) => {
        if (ctx.business.industry !== "hotel") notFound();
        const supabase = await createClient();
        const { count } = await supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("business_id", ctx.business.id);
        return (
          <HotelForm
            action={saveHotel.bind(null, ctx.business.id, null)}
            defaults={hotelDefaults(ctx)}
            backHref={stepPath(ctx.business.id, "operations")}
            roomsLocked={(count ?? 0) > 0}
          />
        );
      }}
    </StepShell>
  );
}
