import { z } from "zod";
import { isValidDate } from "@/lib/reservations/dates";
import type { ToolContext, ToolResult } from "./tools";

/**
 * Booking tools for the reservation assistant.
 *
 * Booking protocol enforced by the DATABASE (not just this prompt):
 *   calculate_booking_price -> returns a quote_id (price computed server-side)
 *   create_reservation(quote_id) succeeds only if the guest sent a NEW message
 *   after the quote was given, the quote is unexpired, belongs to this
 *   conversation, and the price is unchanged.
 * References returned here are the only ones the agent may mention (reply guard).
 */
export type ReservationServices = {
  hotelInformation(): Promise<unknown>;
  roomDetails(roomType: string): Promise<unknown | null>;
  searchAvailability(checkIn: string, checkOut: string, guests: number): Promise<{ results: unknown[] } | { error: string }>;
  quote(roomType: string, checkIn: string, checkOut: string, guests: number): Promise<Record<string, unknown>>;
  createReservation(input: {
    quoteId: string;
    fullName: string;
    email: string;
    phone: string | null;
    specialRequests: string | null;
  }): Promise<Record<string, unknown>>;
  getReservation(reference: string, email: string): Promise<Record<string, unknown>>;
  requestCancellation(reference: string, email: string, reason: string | null): Promise<Record<string, unknown>>;
};

const date = z.string().refine(isValidDate, "Use YYYY-MM-DD").describe("Date in YYYY-MM-DD format.");
const reference = z
  .string()
  .regex(/^[0-9A-Fa-f]{10}$/, "Confirmation numbers have 10 characters (0-9, A-F)")
  .describe("The 10-character confirmation number the guest received.");

function services(ctx: ToolContext): ReservationServices {
  if (!ctx.services.reservations) throw new Error("reservation services unavailable");
  return ctx.services.reservations;
}

function refsFrom(result: Record<string, unknown>): string[] {
  const r = (result.reservation ?? result) as { confirmation_reference?: unknown };
  return typeof r.confirmation_reference === "string" ? [r.confirmation_reference] : [];
}

type Tool<S extends z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  agentTypes: readonly ["reservation_assistant", "voice_receptionist"];
  execute(ctx: ToolContext, args: z.output<S>): Promise<ToolResult>;
};
const types = ["reservation_assistant", "voice_receptionist"] as const;
function tool<S extends z.ZodType>(t: Omit<Tool<S>, "agentTypes">) {
  return { ...t, agentTypes: types };
}

export const reservationTools = [
  tool({
    name: "get_hotel_information",
    description: "Get check-in/check-out times, maximum stay, cancellation rules, policies and the list of room types with base prices.",
    schema: z.strictObject({}),
    async execute(ctx) {
      return { ok: true, data: await services(ctx).hotelInformation(), summary: "Looked up hotel information" };
    },
  }),
  tool({
    name: "get_room_details",
    description: "Get details (capacity, beds, amenities, description, base price) for one room type by its name.",
    schema: z.strictObject({ room_type: z.string().min(1).max(120).describe("Room type name exactly as listed by the hotel.") }),
    async execute(ctx, args) {
      const details = await services(ctx).roomDetails(args.room_type);
      return details
        ? { ok: true, data: details, summary: `Room details: ${args.room_type.slice(0, 60)}` }
        : { ok: false, data: { error: "room_type_not_found" }, summary: "Room type not found" };
    },
  }),
  tool({
    name: "search_room_availability",
    description: "Check real availability for dates and party size. Returns each suitable room type with free room count and total stay price. Always use this before telling a guest anything is available.",
    schema: z.strictObject({
      check_in: date,
      check_out: date,
      guests: z.number().int().min(1).max(50).describe("Number of guests."),
    }),
    async execute(ctx, args) {
      if (args.check_out <= args.check_in) {
        return { ok: false, data: { error: "check_out_must_be_after_check_in" }, summary: "Invalid dates" };
      }
      const found = await services(ctx).searchAvailability(args.check_in, args.check_out, args.guests);
      if ("error" in found) return { ok: false, data: found, summary: "Availability search rejected the dates" };
      return {
        ok: true,
        data: found,
        summary: `Availability ${args.check_in}→${args.check_out}, ${args.guests} guest(s): ${found.results.length} option(s)`,
      };
    },
  }),
  tool({
    name: "calculate_booking_price",
    description:
      "Get a binding price quote for one room type, dates and party size. Returns a quote_id (valid 30 minutes) that is REQUIRED to book. Show the guest the full summary and total, then ask them to confirm. Do not book in the same reply.",
    schema: z.strictObject({
      room_type: z.string().min(1).max(120),
      check_in: date,
      check_out: date,
      guests: z.number().int().min(1).max(50),
    }),
    async execute(ctx, args) {
      if (args.check_out <= args.check_in) {
        return { ok: false, data: { error: "check_out_must_be_after_check_in" }, summary: "Invalid dates" };
      }
      const quote = await services(ctx).quote(args.room_type, args.check_in, args.check_out, args.guests);
      return { ok: quote.available === true, data: quote, summary: quote.available ? `Quoted ${args.room_type.slice(0, 40)} ${args.check_in}→${args.check_out}` : `No quote: ${String(quote.reason ?? "unavailable")}` };
    },
  }),
  tool({
    name: "create_reservation",
    description:
      "Create the reservation from a quote. ONLY call this after the guest has explicitly confirmed the quoted room, dates, guests and total in their latest message, and has given their full name and email. The result's confirmation_reference is the only proof of a booking.",
    schema: z.strictObject({
      quote_id: z.uuid().describe("quote_id from calculate_booking_price."),
      guest_full_name: z.string().min(2).max(200),
      guest_email: z.email().max(320),
      guest_phone: z.string().regex(/^\+?[0-9 ()./-]{5,40}$/).nullable(),
      special_requests: z.string().max(1000).nullable(),
    }),
    async execute(ctx, args) {
      const result = await services(ctx).createReservation({
        quoteId: args.quote_id,
        fullName: args.guest_full_name,
        email: args.guest_email,
        phone: args.guest_phone,
        specialRequests: args.special_requests,
      });
      const ok = result.ok === true;
      return {
        ok,
        data: result,
        references: ok ? refsFrom(result) : [],
        summary: ok
          ? result.dry_run
            ? "Test booking validated (playground, not saved)"
            : `Reservation created: ${refsFrom(result)[0] ?? ""}`
          : `Booking refused: ${String(result.reason ?? "error")}`,
      };
    },
  }),
  tool({
    name: "get_reservation",
    description: "Look up an existing reservation. Requires the confirmation number AND the email address used for the booking.",
    schema: z.strictObject({ confirmation_reference: reference, guest_email: z.email().max(320) }),
    async execute(ctx, args) {
      const result = await services(ctx).getReservation(args.confirmation_reference, args.guest_email);
      const found = result.found !== false;
      return { ok: found, data: result, references: found ? refsFrom(result) : [], summary: found ? "Reservation found" : "Reservation not found" };
    },
  }),
  tool({
    name: "request_reservation_cancellation",
    description:
      "Request cancellation of a reservation. Requires the confirmation number and the booking email. Depending on the hotel's rules it is canceled immediately or handed to staff; report exactly what the result says.",
    schema: z.strictObject({ confirmation_reference: reference, guest_email: z.email().max(320), reason: z.string().max(300).nullable() }),
    async execute(ctx, args) {
      const result = await services(ctx).requestCancellation(args.confirmation_reference, args.guest_email, args.reason);
      return {
        ok: result.ok === true,
        data: result,
        escalated: result.handed_to_staff === true,
        references: result.canceled ? refsFrom(result) : [],
        summary: result.canceled ? "Reservation canceled" : result.handed_to_staff ? "Cancellation request handed to staff" : `Cancellation not possible: ${String(result.reason ?? "")}`,
      };
    },
  }),
];
