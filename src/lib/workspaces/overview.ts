import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceSummary } from "./queries";

/**
 * Data for the dashboard overview of ONE workspace the caller is already
 * known to be a member of (resolved by getActiveWorkspace). RLS still scopes
 * every query to the caller's memberships.
 */
export async function getWorkspaceOverview(workspace: WorkspaceSummary, today?: string) {
  const supabase = await createClient();
  const id = workspace.businessId;

  const [business, subscription, agents, rooms, knowledge] = await Promise.all([
    supabase.from("businesses").select("timezone").eq("id", id).single(),
    supabase.from("subscriptions").select("status, plan_id, trial_ends_at, plans ( name )").eq("business_id", id).maybeSingle(),
    supabase.from("agents").select("id, name, agent_type, enabled, status").eq("business_id", id).order("agent_type"),
    supabase.from("rooms").select("id", { count: "exact", head: true }).eq("business_id", id),
    supabase.from("agent_knowledge").select("id", { count: "exact", head: true }).eq("business_id", id),
  ]);

  for (const r of [business, subscription, agents, rooms, knowledge]) {
    if (r.error) {
      console.error("[dashboard] overview query failed", { code: r.error.code });
      throw new Error("Could not load your workspace overview.");
    }
  }

  // Hotel metrics, computed from reservations for the business's "today".
  let hotel: { arrivals: number; departures: number; inHouse: number; occupancyPct: number | null; upcoming: number; aiBookings30d: number } | null = null;
  if (workspace.industry === "hotel" && today) {
    const [{ data: active }, { count: upcoming }, { count: ai }, { count: bookable }] = await Promise.all([
      supabase
        .from("reservations")
        .select("check_in, check_out, status")
        .eq("business_id", id)
        .in("status", ["confirmed", "checked_in", "checked_out", "pending"])
        .lte("check_in", today)
        .gte("check_out", today),
      supabase.from("reservations").select("id", { count: "exact", head: true }).eq("business_id", id).in("status", ["pending", "confirmed"]).gt("check_in", today),
      supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("business_id", id)
        .in("source", ["ai_website", "ai_voice"])
        .gte("created_at", new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString()),
      supabase.from("rooms").select("id", { count: "exact", head: true }).eq("business_id", id).eq("status", "available"),
    ]);
    const rows = active ?? [];
    const tonight = rows.filter((r) => r.check_in <= today && r.check_out > today && r.status !== "checked_out").length;
    hotel = {
      arrivals: rows.filter((r) => r.check_in === today && r.status !== "checked_out").length,
      departures: rows.filter((r) => r.check_out === today).length,
      inHouse: rows.filter((r) => r.status === "checked_in").length,
      occupancyPct: bookable ? Math.round((tonight / bookable) * 100) : null,
      upcoming: upcoming ?? 0,
      aiBookings30d: ai ?? 0,
    };
  }

  return {
    hotel,
    timezone: business.data!.timezone,
    subscription: subscription.data,
    agents: agents.data ?? [],
    roomCount: rooms.count ?? 0,
    knowledgeCount: knowledge.count ?? 0,
  };
}
