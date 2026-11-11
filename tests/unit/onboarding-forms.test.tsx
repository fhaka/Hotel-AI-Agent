import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanyForm } from "@/components/onboarding/company-form";
import { HotelForm } from "@/components/onboarding/hotel-form";
import { OperationsForm } from "@/components/onboarding/operations-form";
import { NEW_COMPANY_DEFAULTS, hotelDefaults, operationsDefaults } from "@/lib/onboarding/defaults";

/**
 * Render smoke tests: the wizard forms render with realistic data and emit
 * the field names the server-side FormData parsers expect.
 */
const noop = async () => ({ status: "idle" as const });

describe("onboarding forms render", () => {
  it("company form (create) includes all company fields and the trial notice", () => {
    const html = renderToString(
      <CompanyForm
        mode="create"
        action={noop}
        defaults={NEW_COMPANY_DEFAULTS}
        countries={[{ code: "AL", label: "Albania" }]}
        timeZones={["UTC", "Europe/Tirane"]}
      />,
    );
    for (const name of ["name", "industry", "description", "contactEmail", "phone", "website", "country", "city", "address", "timezone", "defaultLanguage", "supportedLanguages"]) {
      expect(html, name).toContain(`name="${name}"`);
    }
    expect(html).toContain("7-day free trial");
  });

  it("operations form pre-fills saved hours, services and FAQs", () => {
    const defaults = operationsDefaults({
      settings: {
        opening_hours: { mon: { mode: "hours", opens: "07:30", closes: "23:00" }, sun: { mode: "closed" } },
        policies: { general: "No smoking", contact_instructions: "Call us" },
      } as never,
      services: [{ id: "1", title: "Spa", content: "Daily", category: "services" }],
      faqs: [{ id: "2", title: "Parking?", content: "Free", category: "faq" }],
    });
    const html = renderToString(<OperationsForm action={noop} defaults={defaults} isHotel backHref="/x" />);
    expect(html).toContain("Reception hours");
    expect(html).toContain('name="hours_mon_opens"');
    expect(html).toContain('value="07:30"');
    expect(html).toContain("No smoking");
    expect(html).toContain('value="Spa"');
    expect(html).toContain('value="Parking?"');
  });

  it("hotel form shows saved room types with prices and room numbers", () => {
    const defaults = hotelDefaults({
      settings: { booking_settings: { check_in_time: "15:00", currency: "EUR" }, policies: { pets: "No pets" } } as never,
      roomTypes: [
        {
          name: "Double",
          description: null,
          maximum_guests: 2,
          bed_configuration: "1 queen",
          amenities: ["Balcony", "Wi-Fi"],
          base_price_cents: 9950,
          currency: "EUR",
          roomNumbers: ["101", "102"],
        },
      ] as never,
    });
    const html = renderToString(<HotelForm action={noop} defaults={defaults} backHref="/x" roomsLocked={false} />);
    for (const name of ["room_name", "room_price", "room_numbers", "room_amenities", "room_max_guests", "checkInTime"]) {
      expect(html, name).toContain(`name="${name}"`);
    }
    expect(html).toContain('value="99.50"');
    expect(html).toContain('value="101, 102"');
    expect(html).toContain('value="Balcony, Wi-Fi"');
    expect(html).toContain('value="15:00"');
    expect(html).toContain("No pets");
  });
});
