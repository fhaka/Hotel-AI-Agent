import type { CompanyDefaults } from "@/components/onboarding/company-form";
import type { HotelDefaults } from "@/components/onboarding/hotel-form";
import type { OperationsDefaults } from "@/components/onboarding/operations-form";
import { centsToInput } from "./parsing";
import type { OnboardingContext } from "./queries";
import { WEEKDAYS, type WeekdayKey } from "./reference-data";
import type { DayHours } from "./schemas";

/** Converts stored workspace data into form default values. Pure functions. */

type Business = OnboardingContext["business"];

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function companyDefaults(business: Business): CompanyDefaults {
  return {
    name: business.name,
    industry: business.industry,
    description: business.description ?? "",
    contactEmail: business.contact_email ?? "",
    phone: business.phone ?? "",
    website: business.website ?? "",
    country: business.country ?? "",
    city: business.city ?? "",
    address: business.address ?? "",
    timezone: business.timezone,
    defaultLanguage: business.default_language,
    supportedLanguages: business.supported_languages,
  };
}

export const NEW_COMPANY_DEFAULTS: CompanyDefaults = {
  name: "",
  industry: "hotel",
  description: "",
  contactEmail: "",
  phone: "",
  website: "",
  country: "",
  city: "",
  address: "",
  timezone: "UTC",
  defaultLanguage: "en",
  supportedLanguages: [],
};

function parseDay(value: unknown): DayHours | undefined {
  const d = obj(value);
  if (d.mode === "closed" || d.mode === "open_24h") return { mode: d.mode };
  if (d.mode === "hours" && typeof d.opens === "string" && typeof d.closes === "string") {
    return { mode: "hours", opens: d.opens, closes: d.closes };
  }
  return undefined;
}

export function operationsDefaults(ctx: Pick<OnboardingContext, "settings" | "services" | "faqs">): OperationsDefaults {
  const hours = obj(ctx.settings.opening_hours);
  const policies = obj(ctx.settings.policies);
  const openingHours: Partial<Record<WeekdayKey, DayHours>> = {};
  for (const d of WEEKDAYS) {
    const parsed = parseDay(hours[d.key]);
    if (parsed) openingHours[d.key] = parsed;
  }
  return {
    openingHours,
    policyGeneral: text(policies.general),
    contactInstructions: text(policies.contact_instructions),
    services: ctx.services.map((s) => ({ title: s.title, content: s.content })),
    faqs: ctx.faqs.map((f) => ({ question: f.title, answer: f.content })),
  };
}

export function hotelDefaults(ctx: Pick<OnboardingContext, "settings" | "roomTypes">): HotelDefaults {
  const booking = obj(ctx.settings.booking_settings);
  const policies = obj(ctx.settings.policies);
  return {
    checkInTime: text(booking.check_in_time) || "14:00",
    checkOutTime: text(booking.check_out_time) || "11:00",
    currency: text(booking.currency) || "EUR",
    maxNights: String(typeof booking.max_nights === "number" ? booking.max_nights : 30),
    freeCancellationHours: String(typeof booking.free_cancellation_hours === "number" ? booking.free_cancellation_hours : 48),
    aiCanCancel: booking.ai_can_cancel === true,
    cancellation: text(policies.cancellation),
    breakfast: text(policies.breakfast),
    parking: text(policies.parking),
    wifi: text(policies.wifi),
    pets: text(policies.pets),
    extraServices: text(policies.extra_services),
    roomTypes: ctx.roomTypes.map((rt) => ({
      name: rt.name,
      description: rt.description ?? "",
      maximumGuests: String(rt.maximum_guests),
      bedConfiguration: rt.bed_configuration ?? "",
      amenities: rt.amenities.join(", "),
      price: centsToInput(rt.base_price_cents),
      roomNumbers: rt.roomNumbers.join(", "),
    })),
  };
}
