import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/**
 * Resolves an inbound phone/WhatsApp number to its business. Only numbers
 * assigned by the platform operator exist in business_channels, and only
 * enabled channels are routed.
 */
export async function resolveNumber(admin: Admin, kind: "voice" | "whatsapp", e164: string) {
  const { data } = await admin
    .from("business_channels")
    .select("business_id, enabled, config, businesses ( name, default_language )")
    .eq("kind", kind)
    .eq("address", e164)
    .maybeSingle();
  if (!data?.enabled) return null;
  const b = data.businesses as unknown as { name: string; default_language: string } | null;
  return { businessId: data.business_id, config: data.config, businessName: b?.name ?? "", defaultLanguage: b?.default_language ?? "en" };
}

export async function findConversation(admin: Admin, businessId: string, channel: "voice" | "whatsapp", externalRef: string, maxIdleHours: number) {
  const { data } = await admin
    .from("agent_conversations")
    .select("id")
    .eq("business_id", businessId)
    .eq("channel", channel)
    .eq("external_ref", externalRef)
    .in("status", ["open", "escalated"])
    .gte("updated_at", new Date(Date.now() - maxIdleHours * 3_600_000).toISOString())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
