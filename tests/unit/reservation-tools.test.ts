import { describe, expect, it, vi } from "vitest";
import { runToolLoop } from "@/lib/agents/runtime/loop";
import { unverifiedReferences } from "@/lib/agents/runtime/prompt";
import type { ReservationServices } from "@/lib/agents/runtime/reservation-tools";
import { toolSpec, toolsFor, type ToolContext } from "@/lib/agents/runtime/tools";
import type { ModelClient, ModelResponse } from "@/lib/agents/runtime/types";

const QUOTE = "3f1c2a1e-0000-4000-8000-000000000001";

function text(t: string): ModelResponse {
  return { text: t, functionCalls: [], outputItems: [], usage: { inputTokens: 1, outputTokens: 1 }, incompleteReason: null, model: "m" };
}
function call(name: string, args: unknown): ModelResponse {
  return { text: "", functionCalls: [{ callId: `c-${name}`, name, arguments: JSON.stringify(args) }], outputItems: [], usage: { inputTokens: 1, outputTokens: 1 }, incompleteReason: null, model: "m" };
}
function scripted(...r: ModelResponse[]): ModelClient {
  return { respond: async () => r.shift()! };
}

function services(overrides: Partial<ReservationServices> = {}): ReservationServices {
  return {
    hotelInformation: vi.fn(async () => ({ check_in_from: "14:00" })),
    roomDetails: vi.fn(async () => null),
    searchAvailability: vi.fn(async () => ({ results: [{ room_type: "Double", available_rooms: 2, total_price: "€200.00" }] })),
    quote: vi.fn(async () => ({ available: true, quote_id: QUOTE, total_price: "€200.00" })),
    createReservation: vi.fn(async () => ({ ok: true, dry_run: false, reservation: { confirmation_reference: "A1B2C3D4E5" } })),
    getReservation: vi.fn(async () => ({ found: false })),
    requestCancellation: vi.fn(async () => ({ ok: true, canceled: false, handed_to_staff: true })),
    ...overrides,
  };
}

function ctx(res: ReservationServices): ToolContext {
  return {
    businessId: "b",
    conversationId: "c",
    agentId: "a",
    escalationMessage: null,
    services: { searchKnowledge: vi.fn(async () => []), escalate: vi.fn(async () => true), reservations: res },
  };
}

const run = (model: ModelClient, res: ReservationServices, priorText: string[] = []) =>
  runToolLoop({
    model,
    instructions: "",
    messages: [{ role: "user", content: "Yes, book it please. Ada Guest, ada@example.test" }],
    tools: toolsFor("reservation_assistant"),
    ctx: ctx(res),
    canary: "HAI-x",
    safetyIdentifier: "s",
    priorText,
  });

describe("reservation assistant tools", () => {
  it("offers the booking tools to the reservation assistant only", () => {
    const names = toolsFor("reservation_assistant").map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search_room_availability", "calculate_booking_price", "create_reservation", "get_reservation", "request_reservation_cancellation", "get_hotel_information", "get_room_details"]));
    expect(toolsFor("website_receptionist").map((t) => t.name)).not.toContain("create_reservation");
    for (const t of toolsFor("reservation_assistant")) {
      const p = toolSpec(t).parameters as { additionalProperties: boolean; required?: string[]; properties: Record<string, unknown> };
      expect(p.additionalProperties).toBe(false);
      expect([...(p.required ?? [])].sort()).toEqual(Object.keys(p.properties).sort());
    }
  });

  it("books from a quote and lets the verified reference through", async () => {
    const res = services();
    const r = await run(
      scripted(
        call("create_reservation", { quote_id: QUOTE, guest_full_name: "Ada Guest", guest_email: "ada@example.test", guest_phone: null, special_requests: null }),
        text("You're booked! Your confirmation number is A1B2C3D4E5."),
      ),
      res,
    );
    expect(res.createReservation).toHaveBeenCalledWith({ quoteId: QUOTE, fullName: "Ada Guest", email: "ada@example.test", phone: null, specialRequests: null });
    expect(r.guard).toBeNull();
    expect(r.reply).toContain("A1B2C3D4E5");
    expect(r.toolEvents[0].summary).toBe("Reservation created: A1B2C3D4E5");
  });

  it("blocks a reply that claims a confirmation number no tool returned", async () => {
    const r = await run(scripted(text("Great news, you're confirmed! Reference FFEE001122.")), services());
    expect(r.guard).toBe("unverified_reference");
    expect(r.reply).not.toContain("FFEE001122");
    expect(r.reply).toMatch(/can't confirm a reservation/);
  });

  it("blocks a fabricated reference even when a booking attempt was refused", async () => {
    const res = services({ createReservation: vi.fn(async () => ({ ok: false, reason: "guest_has_not_confirmed_quote" })) });
    const r = await run(
      scripted(
        call("create_reservation", { quote_id: QUOTE, guest_full_name: "Ada Guest", guest_email: "ada@example.test", guest_phone: null, special_requests: null }),
        text("Done, reference 0123456789."),
      ),
      res,
    );
    expect(r.toolEvents[0]).toMatchObject({ ok: false, summary: "Booking refused: guest_has_not_confirmed_quote" });
    expect(r.guard).toBe("unverified_reference");
  });

  it("does not block the hotel's own phone number from the knowledge", async () => {
    const r = await run(scripted(text("Please call reception on 0123456789.")), services(), ["<business_knowledge>Phone: 0123456789</business_knowledge>"]);
    expect(r.guard).toBeNull();
  });

  it("allows references the guest or earlier replies already mentioned", async () => {
    const r = await run(scripted(text("Your booking 9ABCDEF012 is for 2 nights.")), services(), ["My booking is 9ABCDEF012"]);
    expect(r.guard).toBeNull();
  });

  it("rejects malformed dates, guest counts and quote ids before calling services", async () => {
    const res = services();
    const r = await run(
      scripted(
        call("search_room_availability", { check_in: "next friday", check_out: "2027-01-03", guests: 2 }),
        call("calculate_booking_price", { room_type: "Double", check_in: "2027-01-01", check_out: "2027-01-03", guests: 0 }),
        call("create_reservation", { quote_id: "not-a-uuid", guest_full_name: "A", guest_email: "x", guest_phone: null, special_requests: null }),
        text("Could you give me exact dates?"),
      ),
      res,
    );
    expect(r.toolEvents.every((e) => !e.ok)).toBe(true);
    expect(res.searchAvailability).not.toHaveBeenCalled();
    expect(res.quote).not.toHaveBeenCalled();
    expect(res.createReservation).not.toHaveBeenCalled();
  });

  it("rejects check-out before check-in without hitting the database", async () => {
    const res = services();
    await run(scripted(call("search_room_availability", { check_in: "2027-01-05", check_out: "2027-01-03", guests: 2 }), text("ok")), res);
    expect(res.searchAvailability).not.toHaveBeenCalled();
  });

  it("marks cancellation hand-overs as escalations", async () => {
    const r = await run(
      scripted(call("request_reservation_cancellation", { confirmation_reference: "a1b2c3d4e5", guest_email: "ada@example.test", reason: null }), text("I've passed your cancellation request to our team.")),
      services(),
    );
    expect(r.escalated).toBe(true);
    expect(r.toolEvents[0].summary).toBe("Cancellation request handed to staff");
  });
});

describe("unverifiedReferences", () => {
  it("detects normal and playground references", () => {
    expect(unverifiedReferences("Ref TEST-A1B2C3D4E5 and 0000000000", new Set(["TEST-A1B2C3D4E5"]))).toEqual(["0000000000"]);
    expect(unverifiedReferences("Call us at 0123456789", new Set())).toEqual(["0123456789"]);
  });
});
