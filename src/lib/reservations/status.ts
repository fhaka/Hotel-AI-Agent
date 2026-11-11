import type { Database } from "@/lib/supabase/database.types";

export type ReservationStatus = Database["public"]["Enums"]["reservation_status"];
export type ReservationSource = Database["public"]["Enums"]["reservation_source"];

export const STATUS_INFO: Record<ReservationStatus, { label: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" }> = {
  pending: { label: "Pending", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "brand" },
  checked_in: { label: "Checked in", tone: "success" },
  checked_out: { label: "Checked out", tone: "neutral" },
  canceled: { label: "Canceled", tone: "danger" },
  no_show: { label: "No-show", tone: "danger" },
};

export const SOURCE_LABEL: Record<ReservationSource, string> = {
  dashboard: "Staff",
  ai_website: "AI website assistant",
  ai_voice: "AI phone assistant",
  ai_whatsapp: "AI WhatsApp assistant",
  phone: "Phone",
  email: "Email",
  walk_in: "Walk-in",
  other: "Other",
};

export function isAiSource(source: ReservationSource): boolean {
  return source === "ai_website" || source === "ai_voice" || source === "ai_whatsapp";
}

/** Mirrors public.update_reservation_status() (the database is authoritative). */
const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ["confirmed", "canceled"],
  confirmed: ["checked_in", "no_show", "canceled"],
  checked_in: ["checked_out"],
  checked_out: [],
  canceled: [],
  no_show: [],
};

export function nextStatuses(status: ReservationStatus, today: string, checkIn: string): ReservationStatus[] {
  return TRANSITIONS[status].filter((s) => !((s === "checked_in" || s === "no_show") && today < checkIn));
}

export function isActive(status: ReservationStatus): boolean {
  return status === "pending" || status === "confirmed" || status === "checked_in";
}
