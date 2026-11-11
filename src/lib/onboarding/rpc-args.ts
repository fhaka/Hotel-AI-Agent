import type { Database } from "@/lib/supabase/database.types";
import type { CompanyInput, HotelInput, OperationsInput } from "./schemas";

/**
 * Builds the exact arguments passed to the onboarding database functions from
 * validated form input. Shared by the Server Actions and the contract tests
 * (tests/db/onboarding-contract.test.ts), so both exercise the same mapping.
 */
type Fn = Database["public"]["Functions"];

export function createWorkspaceArgs(c: CompanyInput): Fn["create_business_workspace"]["Args"] {
  return {
    p_name: c.name,
    p_industry: c.industry,
    p_timezone: c.timezone,
    p_default_language: c.defaultLanguage,
    p_supported_languages: c.supportedLanguages,
    p_country: c.country,
    p_city: c.city ?? undefined,
    p_contact_email: c.contactEmail ?? undefined,
    p_description: c.description ?? undefined,
    p_phone: c.phone ?? undefined,
    p_website: c.website ?? undefined,
    p_address: c.address ?? undefined,
  };
}

export function operationsArgs(businessId: string, o: OperationsInput): Fn["save_onboarding_operations"]["Args"] {
  return {
    p_business_id: businessId,
    p_opening_hours: o.openingHours,
    p_policies: o.policies,
    p_services: o.services,
    p_faqs: o.faqs,
  };
}

export function hotelArgs(businessId: string, h: HotelInput): Fn["save_onboarding_hotel"]["Args"] {
  return {
    p_business_id: businessId,
    p_booking_settings: {
      check_in_time: h.checkInTime,
      check_out_time: h.checkOutTime,
      currency: h.currency,
      max_nights: h.maxNights,
      free_cancellation_hours: h.freeCancellationHours,
      ai_can_cancel: h.aiCanCancel,
    },
    p_hotel_policies: h.policies,
    p_room_types: h.roomTypes.map((rt) => ({
      name: rt.name,
      description: rt.description,
      maximum_guests: rt.maximumGuests,
      bed_configuration: rt.bedConfiguration,
      amenities: rt.amenities,
      base_price_cents: rt.basePriceCents,
      room_numbers: rt.roomNumbers,
    })),
  };
}
