import { describe, expect, it } from "vitest";
import { addDays, isValidDate, nightsBetween, todayInZone } from "@/lib/reservations/dates";
import { reservationCancellationEmail, reservationConfirmationEmail, type ReservationEmailData } from "@/lib/reservations/email";
import { likeEscape } from "@/lib/reservations/queries";
import { bookingFromFormData, bookingSchema, rateSchema, staySchema } from "@/lib/reservations/schemas";
import { isAiSource, nextStatuses } from "@/lib/reservations/status";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("dates", () => {
  it("adds days and counts nights across month/DST boundaries", () => {
    expect(addDays("2027-03-27", 2)).toBe("2027-03-29");
    expect(nightsBetween("2027-03-27", "2027-03-29")).toBe(2);
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
  });
  it("validates real calendar dates only", () => {
    expect(isValidDate("2027-02-28")).toBe(true);
    expect(isValidDate("2027-02-30")).toBe(false);
    expect(isValidDate("27-02-2027")).toBe(false);
  });
  it("computes today in the business time zone", () => {
    const instant = new Date("2027-01-01T23:30:00Z");
    expect(todayInZone("Europe/Tirane", instant)).toBe("2027-01-02");
    expect(todayInZone("America/New_York", instant)).toBe("2027-01-01");
  });
});

describe("status transitions mirror the database", () => {
  it("only allows check-in/no-show once the stay started", () => {
    expect(nextStatuses("confirmed", "2027-01-01", "2027-01-05")).toEqual(["canceled"]);
    expect(nextStatuses("confirmed", "2027-01-05", "2027-01-05")).toEqual(["checked_in", "no_show", "canceled"]);
    expect(nextStatuses("checked_in", "2027-01-06", "2027-01-05")).toEqual(["checked_out"]);
    expect(nextStatuses("canceled", "2027-01-06", "2027-01-05")).toEqual([]);
  });
  it("identifies AI sources", () => {
    expect(isAiSource("ai_website")).toBe(true);
    expect(isAiSource("dashboard")).toBe(false);
  });
});

describe("schemas", () => {
  it("validates stays", () => {
    expect(staySchema.safeParse({ checkIn: "2027-01-02", checkOut: "2027-01-02", guests: "2" }).success).toBe(false);
    expect(staySchema.parse({ checkIn: "2027-01-02", checkOut: "2027-01-04", guests: "2" })).toEqual({ checkIn: "2027-01-02", checkOut: "2027-01-04", guests: 2 });
  });

  it("parses a booking form and requires an idempotency key", () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      checkIn: "2027-01-02", checkOut: "2027-01-04", guests: "2", roomTypeId: "3f1c2a1e-0000-4000-8000-000000000000", roomId: "",
      fullName: " Ada ", email: "ADA@example.test", phone: "", preferredLanguage: "en", specialRequests: "", idempotencyKey: "3f1c2a1e-0000-4000-8000-000000000009",
    })) fd.set(k, v);
    const b = bookingSchema.parse(bookingFromFormData(fd));
    expect(b.guest).toEqual({ fullName: "Ada", email: "ada@example.test", phone: null, preferredLanguage: "en" });
    expect(b.roomId).toBeNull();
    fd.set("idempotencyKey", "");
    expect(bookingSchema.safeParse(bookingFromFormData(fd)).success).toBe(false);
  });

  it("requires rate end after start", () => {
    expect(rateSchema.safeParse({ name: "", startsOn: "2027-07-10", endsOn: "2027-07-01", price: "100" }).success).toBe(false);
  });

  it("escapes LIKE wildcards", () => {
    expect(likeEscape("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("guest emails", () => {
  const data: ReservationEmailData = {
    businessName: "Hotel <Adriatik>",
    businessEmail: "info@adriatik.example",
    businessPhone: "+355 52 000 000",
    businessAddress: "Durrës",
    guestName: "Ana <script>",
    reference: "A1B2C3D4E5",
    roomType: "Double",
    checkIn: "2027-07-01",
    checkOut: "2027-07-03",
    nights: 2,
    guests: 2,
    totalCents: 19000,
    currency: "EUR",
    checkInTime: "14:00",
    checkOutTime: "11:00",
    cancellationPolicy: "Free until 48h before arrival",
  };
  it("renders the confirmation with escaped values and all key details", () => {
    const e = reservationConfirmationEmail(data);
    expect(e.subject).toBe("Reservation confirmed — Hotel <Adriatik> (A1B2C3D4E5)");
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("Ana &lt;script&gt;");
    expect(e.text).toContain("Total: €190.00");
    expect(e.text).toContain("Check-in: Thu, 1 Jul 2027 from 14:00");
    expect(e.text).toContain("Free until 48h before arrival");
  });
  it("renders the cancellation", () => {
    expect(reservationCancellationEmail(data).text).toContain("A1B2C3D4E5");
  });
});
