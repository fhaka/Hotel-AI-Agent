import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type SendResult } from "@/lib/email/send";
import type { Database } from "@/lib/supabase/database.types";
import { reservationCancellationEmail, reservationConfirmationEmail, type ReservationEmailData } from "./email";

/**
 * Sends a reservation email to the guest, only AFTER the reservation is
 * committed (callers invoke this once the database function returned).
 * Idempotency keys make retries and double clicks safe. The outcome is
 * recorded in the reservation history. Works with a user client (RLS) or the
 * service-role client.
 */
export async function sendReservationEmail(
  client: SupabaseClient<Database>,
  reservationId: string,
  kind: "confirmation" | "cancellation",
  attempt = "initial",
): Promise<SendResult | { status: "no_guest_email" } | { status: "not_found" }> {
  const { data: r } = await client
    .from("reservations")
    .select("id, business_id, confirmation_reference, check_in, check_out, guests_count, total_price_cents, currency, guests ( full_name, email ), rooms ( room_types ( name ) )")
    .eq("id", reservationId)
    .maybeSingle();
  if (!r) return { status: "not_found" };
  const guest = r.guests as unknown as { full_name: string; email: string | null } | null;
  if (!guest?.email) return { status: "no_guest_email" };

  const [{ data: b }, { data: s }] = await Promise.all([
    client.from("businesses").select("name, contact_email, phone, address, city").eq("id", r.business_id).single(),
    client.from("business_settings").select("booking_settings, policies").eq("business_id", r.business_id).single(),
  ]);
  const booking = (s?.booking_settings ?? {}) as Record<string, unknown>;
  const policies = (s?.policies ?? {}) as Record<string, unknown>;
  const data: ReservationEmailData = {
    businessName: b?.name ?? "Your hotel",
    businessEmail: b?.contact_email ?? null,
    businessPhone: b?.phone ?? null,
    businessAddress: [b?.address, b?.city].filter(Boolean).join(", ") || null,
    guestName: guest.full_name,
    reference: r.confirmation_reference,
    roomType: (r.rooms as unknown as { room_types: { name: string } | null } | null)?.room_types?.name ?? "Room",
    checkIn: r.check_in,
    checkOut: r.check_out,
    nights: Math.round((Date.parse(r.check_out) - Date.parse(r.check_in)) / 86_400_000),
    guests: r.guests_count,
    totalCents: r.total_price_cents,
    currency: r.currency,
    checkInTime: typeof booking.check_in_time === "string" ? booking.check_in_time : null,
    checkOutTime: typeof booking.check_out_time === "string" ? booking.check_out_time : null,
    cancellationPolicy: typeof policies.cancellation === "string" ? policies.cancellation : null,
  };
  const email = kind === "confirmation" ? reservationConfirmationEmail(data) : reservationCancellationEmail(data);
  const result = await sendEmail({
    to: guest.email,
    ...email,
    idempotencyKey: `reservation-${kind}:${r.id}:${attempt}`,
    tags: [{ name: "type", value: `reservation_${kind}` }],
  });
  await client.rpc("log_reservation_email", { p_reservation_id: r.id, p_kind: kind, p_status: result.status });
  return result;
}
