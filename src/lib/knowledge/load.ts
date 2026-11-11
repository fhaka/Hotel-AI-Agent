import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { KnowledgeSources } from "./context";

/**
 * Loads all knowledge sources for ONE business. Every query is explicitly
 * filtered by business_id. With a user-session client, RLS additionally
 * restricts results to the caller's businesses; with the service-role client
 * (public channels, Phase 5) the business_id MUST come from trusted server-side
 * resolution, never from a request body or an AI tool argument.
 */
export async function loadKnowledgeSources(
  client: SupabaseClient<Database>,
  businessId: string,
): Promise<KnowledgeSources | null> {
  const [business, settings, rooms, entries] = await Promise.all([
    client
      .from("businesses")
      .select("name, industry, description, contact_email, phone, website, address, city, country, timezone, default_language, supported_languages")
      .eq("id", businessId)
      .maybeSingle(),
    client.from("business_settings").select("opening_hours, policies, booking_settings").eq("business_id", businessId).maybeSingle(),
    client
      .from("room_types")
      .select("name, description, maximum_guests, bed_configuration, amenities, base_price_cents, currency, is_active")
      .eq("business_id", businessId)
      .order("base_price_cents"),
    client
      .from("agent_knowledge")
      .select("id, title, content, category")
      .eq("business_id", businessId)
      .order("category")
      .order("created_at")
      .limit(1000),
  ]);

  for (const r of [business, settings, rooms, entries]) {
    if (r.error) {
      console.error("[knowledge] load failed", { code: r.error.code });
      throw new Error("Could not load business knowledge.");
    }
  }
  if (!business.data) return null;
  return {
    business: business.data,
    settings: settings.data,
    roomTypes: rooms.data ?? [],
    entries: entries.data ?? [],
  };
}
