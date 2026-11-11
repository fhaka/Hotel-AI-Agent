"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { parseList, parsePriceToCents, parseRoomNumbers } from "@/lib/onboarding/parsing";
import { issuesToFieldErrors } from "@/lib/onboarding/schemas";
import { rateSchema, roomTypeSchema } from "@/lib/reservations/schemas";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type RoomsState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string> };

const PERMISSION = "Only owners, admins and managers can manage rooms.";

function dbMessage(error: { code?: string; message?: string }, context: string): string {
  if (error.code === "42501") return PERMISSION;
  if (error.code === "23505") return error.message?.includes("room_number") ? "That room number already exists." : "A room type with that name already exists.";
  if (error.code === "23503") return "This can't be deleted because reservations or rooms still refer to it. Mark it out of service or inactive instead.";
  if (error.code === "23P01") return "This rate overlaps another seasonal rate for the same room type.";
  if (error.code === "23514") return "Some values are not allowed. Please check the form.";
  console.error(`[rooms] ${context} failed`, { code: error.code });
  return "Something went wrong. Please try again.";
}

async function session() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/rooms");
}

function readRoomType(fd: FormData) {
  const s = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  return { name: s("name"), description: s("description"), maximumGuests: s("maximumGuests"), bedConfiguration: s("bedConfiguration"), amenities: s("amenities"), price: s("price"), isActive: fd.get("isActive") === "on" };
}

export async function saveRoomType(businessId: string, roomTypeId: string | null, _prev: RoomsState, formData: FormData): Promise<RoomsState> {
  await session();
  if (!isUuid(businessId) || (roomTypeId !== null && !isUuid(roomTypeId))) return { status: "error", message: "Invalid request." };
  const parsed = roomTypeSchema.safeParse(readRoomType(formData));
  if (!parsed.success) return { status: "error", fieldErrors: issuesToFieldErrors(parsed.error) };
  const cents = parsePriceToCents(parsed.data.price);
  if (cents === null) return { status: "error", fieldErrors: { price: "Enter a price like 120 or 120.50" } };
  const values = {
    name: parsed.data.name,
    description: parsed.data.description,
    maximum_guests: parsed.data.maximumGuests,
    bed_configuration: parsed.data.bedConfiguration,
    amenities: parseList(parsed.data.amenities),
    base_price_cents: cents,
    is_active: parsed.data.isActive,
  };
  const supabase = await createClient();
  if (roomTypeId) {
    const { data, error } = await supabase.from("room_types").update(values).eq("id", roomTypeId).eq("business_id", businessId).select("id");
    if (error) return { status: "error", message: dbMessage(error, "update type") };
    if (!data?.length) return { status: "error", message: PERMISSION };
    revalidatePath("/dashboard/rooms");
    return { status: "success", message: "Room type saved." };
  }
  const { data: settings } = await supabase.from("business_settings").select("booking_settings").eq("business_id", businessId).single();
  const currency = ((settings?.booking_settings ?? {}) as { currency?: string }).currency ?? "EUR";
  const { data, error } = await supabase.from("room_types").insert({ business_id: businessId, currency, ...values }).select("id").single();
  if (error || !data) return { status: "error", message: dbMessage(error ?? { code: "42501" }, "create type") };
  revalidatePath("/dashboard/rooms");
  redirect(`/dashboard/rooms/${data.id}?created=1`);
}

export async function addRooms(businessId: string, roomTypeId: string, _prev: RoomsState, formData: FormData): Promise<RoomsState> {
  await session();
  if (!isUuid(businessId) || !isUuid(roomTypeId)) return { status: "error", message: "Invalid request." };
  const parsed = parseRoomNumbers(String(formData.get("roomNumbers") ?? ""));
  if ("error" in parsed) return { status: "error", fieldErrors: { roomNumbers: parsed.error } };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rooms")
    .insert(parsed.rooms.map((room_number) => ({ business_id: businessId, room_type_id: roomTypeId, room_number })));
  if (error) return { status: "error", message: dbMessage(error, "add rooms") };
  revalidatePath(`/dashboard/rooms/${roomTypeId}`);
  return { status: "success", message: `${parsed.rooms.length} room(s) added.` };
}

export async function setRoomStatus(roomTypeId: string, _prev: RoomsState, formData: FormData): Promise<RoomsState> {
  await session();
  const roomId = formData.get("roomId");
  const status = z.enum(["available", "out_of_service", "retired"]).safeParse(formData.get("status"));
  if (!isUuid(roomId) || !status.success) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("rooms").update({ status: status.data }).eq("id", roomId).select("id");
  if (error) return { status: "error", message: dbMessage(error, "room status") };
  if (!data?.length) return { status: "error", message: PERMISSION };
  revalidatePath(`/dashboard/rooms/${roomTypeId}`);
  return { status: "success", message: "Room updated." };
}

export async function deleteRoom(roomTypeId: string, _prev: RoomsState, formData: FormData): Promise<RoomsState> {
  await session();
  const roomId = formData.get("roomId");
  if (!isUuid(roomId)) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("rooms").delete().eq("id", roomId).select("id");
  if (error) return { status: "error", message: dbMessage(error, "delete room") };
  if (!data?.length) return { status: "error", message: "Only owners and admins can delete rooms." };
  revalidatePath(`/dashboard/rooms/${roomTypeId}`);
  return { status: "success", message: "Room deleted." };
}

export async function addRate(businessId: string, roomTypeId: string, _prev: RoomsState, formData: FormData): Promise<RoomsState> {
  await session();
  if (!isUuid(businessId) || !isUuid(roomTypeId)) return { status: "error", message: "Invalid request." };
  const parsed = rateSchema.safeParse({ name: formData.get("name") ?? "", startsOn: formData.get("startsOn"), endsOn: formData.get("endsOn"), price: formData.get("price") ?? "" });
  if (!parsed.success) return { status: "error", fieldErrors: issuesToFieldErrors(parsed.error) };
  const cents = parsePriceToCents(parsed.data.price);
  if (cents === null) return { status: "error", fieldErrors: { price: "Enter a price like 120 or 120.50" } };
  const supabase = await createClient();
  const { error } = await supabase.from("room_type_rates").insert({
    business_id: businessId,
    room_type_id: roomTypeId,
    name: parsed.data.name,
    starts_on: parsed.data.startsOn,
    ends_on: parsed.data.endsOn,
    nightly_price_cents: cents,
  });
  if (error) return { status: "error", message: dbMessage(error, "add rate") };
  revalidatePath(`/dashboard/rooms/${roomTypeId}`);
  return { status: "success", message: "Seasonal rate added. New quotes and bookings use it; existing reservations keep their price." };
}

export async function deleteRate(roomTypeId: string, _prev: RoomsState, formData: FormData): Promise<RoomsState> {
  await session();
  const rateId = formData.get("rateId");
  if (!isUuid(rateId)) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("room_type_rates").delete().eq("id", rateId).select("id");
  if (error) return { status: "error", message: dbMessage(error, "delete rate") };
  if (!data?.length) return { status: "error", message: PERMISSION };
  revalidatePath(`/dashboard/rooms/${roomTypeId}`);
  return { status: "success", message: "Rate deleted." };
}
