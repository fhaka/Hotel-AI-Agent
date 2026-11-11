"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { issuesToFieldErrors } from "@/lib/onboarding/schemas";
import { sendReservationEmail } from "@/lib/reservations/notify";
import { bookingFromFormData, bookingSchema, staySchema } from "@/lib/reservations/schemas";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type ActionState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string> };

export type AvailabilityResult = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  stay?: { checkIn: string; checkOut: string; guests: number };
  options?: { roomTypeId: string; name: string; maximumGuests: number; availableRooms: number; nights: number; totalPriceCents: number; currency: string }[];
};

const DB_MESSAGES: Record<string, string> = {
  "42501": "You don't have permission to do that.",
  "54001": "Your plan is not active, so new reservations can't be created. Choose a plan to continue.",
  "23P01": "No room of this type is free for these dates any more. Search again.",
  "55000": "This change isn't possible for the reservation's current status.",
  P0002: "Reservation or room type not found.",
};

function dbMessage(error: { code?: string; message?: string } | null, context: string): string {
  if (!error) return "Something went wrong.";
  if (error.code === "22023") return capitalize(error.message ?? "Invalid details.");
  if (error.code && DB_MESSAGES[error.code]) return DB_MESSAGES[error.code];
  console.error(`[reservations] ${context} failed`, { code: error.code });
  return "Something went wrong. Please try again.";
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1) + (s.endsWith(".") ? "" : ".");
}

async function session(path = "/dashboard/reservations") {
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(path)}`);
  return user;
}

export async function searchAvailability(businessId: string, _prev: AvailabilityResult, formData: FormData): Promise<AvailabilityResult> {
  await session();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const parsed = staySchema.safeParse({ checkIn: formData.get("checkIn"), checkOut: formData.get("checkOut"), guests: formData.get("guests") });
  if (!parsed.success) return { status: "error", fieldErrors: issuesToFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_room_availability", {
    p_business_id: businessId,
    p_check_in: parsed.data.checkIn,
    p_check_out: parsed.data.checkOut,
    p_guests: parsed.data.guests,
  });
  if (error) return { status: "error", message: dbMessage(error, "availability") };
  return {
    status: "success",
    stay: parsed.data,
    options: (data ?? []).map((r) => ({
      roomTypeId: r.room_type_id,
      name: r.name,
      maximumGuests: r.maximum_guests,
      availableRooms: r.available_rooms,
      nights: r.nights,
      totalPriceCents: r.total_price_cents,
      currency: r.currency,
    })),
  };
}

export async function createReservation(businessId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await session();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const parsed = bookingSchema.safeParse(bookingFromFormData(formData));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  const b = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_reservation", {
    p_business_id: businessId,
    p_room_type_id: b.roomTypeId,
    p_room_id: b.roomId as string,
    p_check_in: b.stay.checkIn,
    p_check_out: b.stay.checkOut,
    p_guests: b.stay.guests,
    p_guest: { full_name: b.guest.fullName, email: b.guest.email, phone: b.guest.phone, preferred_language: b.guest.preferredLanguage },
    p_special_requests: b.specialRequests as string,
    p_idempotency_key: b.idempotencyKey,
  });
  if (error || !data) return { status: "error", message: dbMessage(error, "create") };
  const reservation = data as { id: string; duplicate?: boolean };

  let email = "none";
  if (!reservation.duplicate && formData.get("sendConfirmation") === "on") {
    // Sent only now that the booking has been committed.
    email = (await sendReservationEmail(supabase, reservation.id, "confirmation")).status;
  }
  revalidatePath("/dashboard/reservations");
  redirect(`/dashboard/reservations/${reservation.id}?created=1&email=${encodeURIComponent(email)}`);
}

export async function changeStatus(reservationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await session();
  const status = z.enum(["confirmed", "checked_in", "checked_out", "no_show"]).safeParse(formData.get("status"));
  if (!isUuid(reservationId) || !status.success) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_reservation_status", { p_reservation_id: reservationId, p_status: status.data });
  if (error) return { status: "error", message: dbMessage(error, "status") };
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { status: "success", message: "Status updated." };
}

export async function cancelReservation(reservationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await session();
  if (!isUuid(reservationId)) return { status: "error", message: "Invalid request." };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_reservation", { p_reservation_id: reservationId, p_reason: reason });
  if (error) return { status: "error", message: dbMessage(error, "cancel") };
  let note = "";
  if (formData.get("notifyGuest") === "on") {
    const sent = await sendReservationEmail(supabase, reservationId, "cancellation");
    note = sent.status === "sent" ? " The guest was notified by email." : " The guest was NOT emailed (email not configured or no address).";
  }
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { status: "success", message: `Reservation canceled.${note}` };
}

export async function modifyReservation(reservationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await session();
  if (!isUuid(reservationId)) return { status: "error", message: "Invalid request." };
  const parsed = staySchema.safeParse({ checkIn: formData.get("checkIn"), checkOut: formData.get("checkOut"), guests: formData.get("guests") });
  if (!parsed.success) return { status: "error", fieldErrors: issuesToFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("modify_reservation", {
    p_reservation_id: reservationId,
    p_check_in: parsed.data.checkIn,
    p_check_out: parsed.data.checkOut,
    p_guests: parsed.data.guests,
  });
  if (error) return { status: "error", message: dbMessage(error, "modify") };
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { status: "success", message: "Reservation updated and price recalculated." };
}

export async function resendConfirmation(reservationId: string, _prev: ActionState): Promise<ActionState> {
  await session();
  if (!isUuid(reservationId)) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const result = await sendReservationEmail(supabase, reservationId, "confirmation", `resend-${Date.now()}`);
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  const messages: Record<string, string> = {
    sent: "Confirmation email sent.",
    not_configured: "Email sending is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL).",
    no_guest_email: "This guest has no email address.",
    not_found: "Reservation not found.",
    failed: "The email could not be sent. Please try again later.",
  };
  return { status: result.status === "sent" ? "success" : "error", message: messages[result.status] };
}

export async function updateSpecialRequests(reservationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await session();
  if (!isUuid(reservationId)) return { status: "error", message: "Invalid request." };
  const value = String(formData.get("specialRequests") ?? "").trim().slice(0, 2000);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .update({ special_requests: value || null })
    .eq("id", reservationId)
    .select("id");
  if (error || !data?.length) return { status: "error", message: dbMessage(error ?? { code: "42501" }, "notes") };
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { status: "success", message: "Saved." };
}
