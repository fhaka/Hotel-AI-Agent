import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { saveHotel } from "@/app/onboarding/actions";
import { BusinessSettingsShell } from "@/components/business/business-settings-shell";
import { HotelForm } from "@/components/onboarding/hotel-form";
import { hotelDefaults } from "@/lib/onboarding/defaults";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hotel & rooms" };

export default function BusinessHotelPage({ searchParams }: PageProps<"/dashboard/business/hotel">) {
  return (
    <BusinessSettingsShell tab="hotel" searchParams={searchParams}>
      {async (ctx) => {
        if (ctx.business.industry !== "hotel") notFound();
        const supabase = await createClient();
        const { count } = await supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("business_id", ctx.business.id);
        return (
          <HotelForm
            action={saveHotel.bind(null, ctx.business.id, "/dashboard/business/hotel")}
            defaults={hotelDefaults(ctx)}
            roomsLocked={(count ?? 0) > 0}
            submitLabel="Save changes"
          />
        );
      }}
    </BusinessSettingsShell>
  );
}
