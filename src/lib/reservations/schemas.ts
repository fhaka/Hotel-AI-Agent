import { z } from "zod";
import { isValidDate } from "./dates";

const date = z.string().refine(isValidDate, "Use a valid date (YYYY-MM-DD)");

export const staySchema = z
  .object({
    checkIn: date,
    checkOut: date,
    guests: z.coerce.number({ error: "Enter the number of guests" }).int().min(1, "At least 1 guest").max(50, "At most 50 guests"),
  })
  .refine((v) => v.checkOut > v.checkIn, { path: ["checkOut"], message: "Check-out must be after check-in" });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const guestDetailsSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the guest's name").max(200),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address")
    .transform((v) => (v === "" ? null : v)),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v === "" || /^\+?[0-9 ()./-]{5,40}$/.test(v), "Enter a valid phone number")
    .transform((v) => (v === "" ? null : v)),
  preferredLanguage: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[a-z]{2}(-[A-Z]{2})?$/.test(v), "Use a language code like en or de")
    .transform((v) => (v === "" ? null : v)),
});

export const bookingSchema = z.object({
  stay: staySchema,
  roomTypeId: z.uuid("Choose a room type"),
  roomId: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid().nullable()),
  guest: guestDetailsSchema,
  specialRequests: optionalText(2000),
  idempotencyKey: z.uuid(),
});

export function bookingFromFormData(fd: FormData) {
  const s = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  return {
    stay: { checkIn: s("checkIn"), checkOut: s("checkOut"), guests: s("guests") },
    roomTypeId: s("roomTypeId"),
    roomId: s("roomId"),
    guest: { fullName: s("fullName"), email: s("email"), phone: s("phone"), preferredLanguage: s("preferredLanguage") },
    specialRequests: s("specialRequests"),
    idempotencyKey: s("idempotencyKey"),
  };
}

export const roomTypeSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  description: optionalText(5000),
  maximumGuests: z.coerce.number().int().min(1).max(50),
  bedConfiguration: optionalText(200),
  amenities: z.string().max(2000),
  price: z.string(),
  isActive: z.boolean(),
});

export const rateSchema = z
  .object({
    name: optionalText(120),
    startsOn: date,
    endsOn: date,
    price: z.string(),
  })
  .refine((v) => v.endsOn > v.startsOn, { path: ["endsOn"], message: "The end date must be after the start date" });
