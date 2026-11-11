import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceSummary } from "./queries";

/**
 * Data for the dashboard overview of ONE workspace the caller is already
 * known to be a member of (resolved by getActiveWorkspace). RLS still scopes
 * every query to the caller's memberships.
 */
export async function getWorkspaceOverview(workspace: WorkspaceSummary) {
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

  return {
    timezone: business.data!.timezone,
    subscription: subscription.data,
    agents: agents.data ?? [],
    roomCount: rooms.count ?? 0,
    knowledgeCount: knowledge.count ?? 0,
  };
}
