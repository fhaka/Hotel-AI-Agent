import { describe, expect, it } from "vitest";
import {
  companyFromFormData,
  companySchema,
  hotelFromFormData,
  hotelSchema,
  issuesToFieldErrors,
  operationsFromFormData,
  operationsSchema,
} from "@/lib/onboarding/schemas";

function fd(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

const company: [string, string][] = [
  ["name", "  Hotel Riviera "],
  ["industry", "hotel"],
  ["description", ""],
  ["contactEmail", "Info@Riviera.example"],
  ["phone", "+355 69 123 4567"],
  ["website", "riviera.example"],
  ["country", "al"],
  ["city", "Durrës"],
  ["address", ""],
  ["timezone", "Europe/Tirane"],
  ["defaultLanguage", "sq"],
  ["supportedLanguages", "en"],
  ["supportedLanguages", "it"],
];

describe("companySchema", () => {
  it("normalises valid input", () => {
    const r = companySchema.parse(companyFromFormData(fd(company)));
    expect(r).toMatchObject({
      name: "Hotel Riviera",
      contactEmail: "info@riviera.example",
      website: "https://riviera.example",
      country: "AL",
      description: null,
      address: null,
      supportedLanguages: ["sq", "en", "it"],
    });
  });

  it("rejects unknown time zones, countries and industries", () => {
    const bad = company.map(([k, v]): [string, string] =>
      k === "timezone" ? [k, "Mars/Base"] : k === "country" ? [k, "ZZ"] : k === "industry" ? [k, "casino"] : [k, v],
    );
    const r = companySchema.safeParse(companyFromFormData(fd(bad)));
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(issuesToFieldErrors(r.error)).sort()).toEqual(["country", "industry", "timezone"]);
  });

  it("rejects javascript: and malformed websites", () => {
    for (const website of ["javascript:alert(1)", "not a url", "http://localhost"]) {
      const r = companySchema.safeParse(
        companyFromFormData(fd(company.map(([k, v]): [string, string] => (k === "website" ? [k, website] : [k, v])))),
      );
      expect(r.success, website).toBe(false);
    }
  });
});

function hoursEntries(mode = "hours", opens = "08:00", closes = "20:00"): [string, string][] {
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].flatMap((d): [string, string][] => [
    [`hours_${d}_mode`, mode],
    [`hours_${d}_opens`, opens],
    [`hours_${d}_closes`, closes],
  ]);
}

describe("operationsSchema", () => {
  it("parses hours, services and FAQs, dropping blank rows", () => {
    const r = operationsSchema.parse(
      operationsFromFormData(
        fd([
          ...hoursEntries("open_24h"),
          ["policyGeneral", "No smoking"],
          ["contactInstructions", ""],
          ["service_title", "Spa"],
          ["service_content", "Open daily"],
          ["service_title", ""],
          ["service_content", ""],
          ["faq_question", "Parking?"],
          ["faq_answer", "Free"],
        ]),
      ),
    );
    expect(r.openingHours.mon).toEqual({ mode: "open_24h" });
    expect(r.services).toEqual([{ title: "Spa", content: "Open daily" }]);
    expect(r.faqs).toEqual([{ question: "Parking?", answer: "Free" }]);
    expect(r.policies).toEqual({ general: "No smoking", contact_instructions: null });
  });

  it("requires valid times when a day has opening hours", () => {
    const r = operationsSchema.safeParse(operationsFromFormData(fd(hoursEntries("hours", "25:00", "8pm"))));
    expect(r.success).toBe(false);
    if (!r.success) {
      const errors = issuesToFieldErrors(r.error);
      expect(errors["openingHours.mon.opens"]).toBeDefined();
      expect(errors["openingHours.mon.closes"]).toBeDefined();
    }
  });

  it("rejects half-filled FAQ rows", () => {
    const r = operationsSchema.safeParse(
      operationsFromFormData(fd([...hoursEntries("closed"), ["faq_question", "Pets?"], ["faq_answer", ""]])),
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(issuesToFieldErrors(r.error)["faqs.0.answer"]).toBe("Enter the answer");
  });
});

function room(name: string, numbers: string, price = "120"): [string, string][] {
  return [
    ["room_name", name],
    ["room_description", ""],
    ["room_max_guests", "2"],
    ["room_beds", "1 double"],
    ["room_amenities", "Wi-Fi, Balcony"],
    ["room_price", price],
    ["room_numbers", numbers],
  ];
}

const hotelBase: [string, string][] = [
  ["checkInTime", "14:00"],
  ["checkOutTime", "11:00"],
  ["currency", "EUR"],
  ["cancellation", "Free until 48h before arrival"],
];

describe("hotelSchema", () => {
  it("parses room types into cents and room lists", () => {
    const r = hotelSchema.parse(hotelFromFormData(fd([...hotelBase, ...room("Double", "101-102", "99,50")])));
    expect(r.roomTypes).toEqual([
      {
        name: "Double",
        description: null,
        maximumGuests: 2,
        bedConfiguration: "1 double",
        amenities: ["Wi-Fi", "Balcony"],
        basePriceCents: 9950,
        roomNumbers: ["101", "102"],
      },
    ]);
    expect(r.policies.cancellation).toBe("Free until 48h before arrival");
  });

  it("requires at least one room type", () => {
    const r = hotelSchema.safeParse(hotelFromFormData(fd(hotelBase)));
    expect(r.success).toBe(false);
  });

  it("rejects bad prices, duplicate names and rooms shared between types", () => {
    const r = hotelSchema.safeParse(
      hotelFromFormData(fd([...hotelBase, ...room("Double", "101-103", "free"), ...room("double", "103")])),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      const errors = issuesToFieldErrors(r.error);
      expect(errors["roomTypes.0.price"]).toMatch(/price/);
      expect(errors["roomTypes.1.name"]).toMatch(/unique/);
      expect(errors["roomTypes.1.roomNumbers"]).toMatch(/Room 103/);
    }
  });
});
