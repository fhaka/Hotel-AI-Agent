import { z } from "zod";
import { COUNTRY_CODES, CURRENCIES, LANGUAGE_CODES, WEEKDAYS, type WeekdayKey, timeZoneOptions } from "./reference-data";
import { parseList, parsePriceToCents, parseRoomNumbers } from "./parsing";

/**
 * Server-enforced validation for each onboarding step. The database applies
 * its own constraints as a second line of defence.
 */

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform((v) => (v === "" ? null : v));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

// ---------------------------------------------------------------------------
// Step 1 — company
// ---------------------------------------------------------------------------
export const companySchema = z
  .object({
    name: z.string().trim().min(2, "Enter your business name").max(120, "Name is too long"),
    industry: z.enum(["hotel", "restaurant", "beauty_salon", "clinic", "real_estate", "other"], {
      error: "Choose your industry",
    }),
    description: optionalText(5000, "Description"),
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(320)
      .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address")
      .transform((v) => (v === "" ? null : v)),
    phone: z
      .string()
      .trim()
      .max(40, "Phone number is too long")
      .refine((v) => v === "" || /^\+?[0-9 ()./-]{5,40}$/.test(v), "Enter a valid phone number")
      .transform((v) => (v === "" ? null : v)),
    website: z
      .string()
      .trim()
      .max(2048)
      .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
      .refine((v) => {
        if (v === "") return true;
        try {
          const u = new URL(v);
          return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
        } catch {
          return false;
        }
      }, "Enter a valid website address")
      .transform((v) => (v === "" ? null : v)),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => COUNTRY_CODES.includes(v), "Choose a country"),
    city: optionalText(120, "City"),
    address: optionalText(500, "Address"),
    timezone: z.string().refine((v) => timeZoneOptions().includes(v), "Choose a time zone"),
    defaultLanguage: z.string().refine((v) => LANGUAGE_CODES.includes(v), "Choose a language"),
    supportedLanguages: z
      .array(z.string().refine((v) => LANGUAGE_CODES.includes(v), "Unsupported language"))
      .max(20, "Choose at most 20 languages"),
  })
  .transform((v) => ({
    ...v,
    // The default language is always supported.
    supportedLanguages: [v.defaultLanguage, ...v.supportedLanguages.filter((l) => l !== v.defaultLanguage)],
  }));

export type CompanyInput = z.output<typeof companySchema>;

export function companyFromFormData(fd: FormData) {
  return {
    name: str(fd, "name"),
    industry: str(fd, "industry"),
    description: str(fd, "description"),
    contactEmail: str(fd, "contactEmail"),
    phone: str(fd, "phone"),
    website: str(fd, "website"),
    country: str(fd, "country"),
    city: str(fd, "city"),
    address: str(fd, "address"),
    timezone: str(fd, "timezone"),
    defaultLanguage: str(fd, "defaultLanguage"),
    supportedLanguages: all(fd, "supportedLanguages"),
  };
}

// ---------------------------------------------------------------------------
// Step 2 — operations
// ---------------------------------------------------------------------------
const daySchema = z
  .object({
    mode: z.enum(["closed", "open_24h", "hours"]),
    opens: z.string(),
    closes: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.mode !== "hours") return;
    if (!time.safeParse(d.opens).success) ctx.addIssue({ code: "custom", path: ["opens"], message: "Use HH:MM" });
    if (!time.safeParse(d.closes).success) ctx.addIssue({ code: "custom", path: ["closes"], message: "Use HH:MM" });
  })
  .transform((d) => (d.mode === "hours" ? d : { mode: d.mode }));

export type DayHours = { mode: "closed" | "open_24h" } | { mode: "hours"; opens: string; closes: string };

export const operationsSchema = z.object({
  openingHours: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d.key, daySchema])) as Record<WeekdayKey, typeof daySchema>),
  policies: z.object({
    general: optionalText(5000, "Business policies"),
    contact_instructions: optionalText(2000, "Contact instructions"),
  }),
  services: z
    .array(
      z.object({
        title: z.string().trim().min(1, "Enter a service name").max(200),
        content: z.string().trim().min(1, "Describe the service").max(5000),
      }),
    )
    .max(50, "At most 50 services"),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(1, "Enter the question").max(200, "Keep questions under 200 characters"),
        answer: z.string().trim().min(1, "Enter the answer").max(5000),
      }),
    )
    .max(100, "At most 100 FAQs"),
});

export type OperationsInput = z.output<typeof operationsSchema>;

export function operationsFromFormData(fd: FormData) {
  return {
    openingHours: Object.fromEntries(
      WEEKDAYS.map((d) => [
        d.key,
        { mode: str(fd, `hours_${d.key}_mode`), opens: str(fd, `hours_${d.key}_opens`), closes: str(fd, `hours_${d.key}_closes`) },
      ]),
    ),
    policies: { general: str(fd, "policyGeneral"), contact_instructions: str(fd, "contactInstructions") },
    // Fully blank rows (e.g. an unused "add another" row) are dropped.
    services: zipRows(fd, { title: "service_title", content: "service_content" }),
    faqs: zipRows(fd, { question: "faq_question", answer: "faq_answer" }),
  };
}

// ---------------------------------------------------------------------------
// Step 3 — hotel
// ---------------------------------------------------------------------------
const roomTypeSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a room type name").max(120),
    description: optionalText(5000, "Description"),
    maximumGuests: z.coerce
      .number({ error: "Enter the maximum number of guests" })
      .int("Use a whole number")
      .min(1, "At least 1 guest")
      .max(50, "At most 50 guests"),
    bedConfiguration: optionalText(200, "Bed configuration"),
    amenities: z.string().max(2000).transform((v) => parseList(v)),
    price: z.string(),
    roomNumbers: z.string().max(5000),
  })
  .transform((r, ctx) => {
    const cents = parsePriceToCents(r.price);
    if (cents === null) {
      ctx.addIssue({ code: "custom", path: ["price"], message: "Enter a price like 120 or 120.50" });
    }
    const rooms = parseRoomNumbers(r.roomNumbers);
    if ("error" in rooms) {
      ctx.addIssue({ code: "custom", path: ["roomNumbers"], message: rooms.error });
    }
    return {
      name: r.name,
      description: r.description,
      maximumGuests: r.maximumGuests,
      bedConfiguration: r.bedConfiguration,
      amenities: r.amenities,
      basePriceCents: cents ?? 0,
      roomNumbers: "rooms" in rooms ? rooms.rooms : [],
    };
  });

export const hotelSchema = z
  .object({
    checkInTime: time,
    checkOutTime: time,
    currency: z.string().refine((v) => CURRENCIES.includes(v), "Choose a currency"),
    policies: z.object({
      cancellation: optionalText(3000, "Cancellation policy"),
      breakfast: optionalText(2000, "Breakfast information"),
      parking: optionalText(2000, "Parking information"),
      wifi: optionalText(1000, "Wi-Fi information"),
      pets: optionalText(1000, "Pet policy"),
      extra_services: optionalText(3000, "Extra services"),
    }),
    roomTypes: z.array(roomTypeSchema).min(1, "Add at least one room type").max(50, "At most 50 room types"),
  })
  .superRefine(
    (h, ctx) => {
      // Runs even when individual fields failed (see `when` below), so the
      // user sees every problem at once. Values may be partially unparsed.
      const roomTypes: unknown[] = Array.isArray(h.roomTypes) ? h.roomTypes : [];
      const names = new Set<string>();
      const rooms = new Map<string, string>();
      roomTypes.forEach((value, i) => {
        const rt = value as { name?: unknown; roomNumbers?: unknown };
        const name = typeof rt.name === "string" ? rt.name.trim() : "";
        if (name) {
          if (names.has(name.toLowerCase())) {
            ctx.addIssue({ code: "custom", path: ["roomTypes", i, "name"], message: "Room type names must be unique" });
          }
          names.add(name.toLowerCase());
        }
        const numbers = Array.isArray(rt.roomNumbers) ? (rt.roomNumbers as string[]) : [];
        for (const n of numbers) {
          const owner = rooms.get(n);
          if (owner !== undefined) {
            ctx.addIssue({
              code: "custom",
              path: ["roomTypes", i, "roomNumbers"],
              message: `Room ${n} is also listed under "${owner}"`,
            });
            return;
          }
          rooms.set(n, name);
        }
      });
      if (rooms.size > 1000) ctx.addIssue({ code: "custom", path: ["roomTypes"], message: "At most 1000 rooms" });
    },
    { when: () => true },
  );

export type HotelInput = z.output<typeof hotelSchema>;

export function hotelFromFormData(fd: FormData) {
  return {
    checkInTime: str(fd, "checkInTime"),
    checkOutTime: str(fd, "checkOutTime"),
    currency: str(fd, "currency"),
    policies: {
      cancellation: str(fd, "cancellation"),
      breakfast: str(fd, "breakfast"),
      parking: str(fd, "parking"),
      wifi: str(fd, "wifi"),
      pets: str(fd, "pets"),
      extra_services: str(fd, "extraServices"),
    },
    roomTypes: zipRows(fd, {
      name: "room_name",
      description: "room_description",
      maximumGuests: "room_max_guests",
      bedConfiguration: "room_beds",
      amenities: "room_amenities",
      price: "room_price",
      roomNumbers: "room_numbers",
    }),
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function all(fd: FormData, key: string): string[] {
  return fd.getAll(key).filter((v): v is string => typeof v === "string");
}

/** Zips parallel `name[]` style fields into row objects, dropping blank rows. */
function zipRows<K extends string>(fd: FormData, fields: Record<K, string>): Record<K, string>[] {
  const keys = Object.keys(fields) as K[];
  const columns = keys.map((k) => all(fd, fields[k]));
  const length = Math.max(0, ...columns.map((c) => c.length));
  const rows: Record<K, string>[] = [];
  for (let i = 0; i < length; i++) {
    const row = Object.fromEntries(keys.map((k, j) => [k, columns[j][i] ?? ""])) as Record<K, string>;
    if (keys.some((k) => row[k].trim() !== "")) rows.push(row);
  }
  return rows.slice(0, 200);
}

/**
 * Flattens Zod issues to "path.to.field" -> message, e.g.
 * "roomTypes.1.price" or "openingHours.mon.opens".
 */
export function issuesToFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    out[key] ??= issue.message;
  }
  return out;
}
