import "server-only";
import { createClient } from "@/lib/supabase/server";

export const RESERVATION_LIST_SELECT =
  "id, confirmation_reference, check_in, check_out, guests_count, status, source, total_price_cents, currency, created_at, guests!inner ( id, full_name, email ), rooms ( room_number, room_types ( name ) )";

export type ReservationListRow = {
  id: string;
  confirmation_reference: string;
  check_in: string;
  check_out: string;
  guests_count: number;
  status: "pending" | "confirmed" | "canceled" | "checked_in" | "checked_out" | "no_show";
  source: "dashboard" | "ai_website" | "ai_voice" | "phone" | "email" | "walk_in" | "other";
  total_price_cents: number;
  currency: string;
  created_at: string;
  guests: { id: string; full_name: string; email: string | null };
  rooms: { room_number: string; room_types: { name: string } | null } | null;
};

/** Escapes LIKE wildcards so user input matches literally. */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function businessTimezone(businessId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("timezone").eq("id", businessId).single();
  return data?.timezone ?? "UTC";
}
