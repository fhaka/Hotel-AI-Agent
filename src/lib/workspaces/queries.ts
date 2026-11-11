import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth/session";

export type WorkspaceSummary = {
  businessId: string;
  name: string;
  industry: string;
  role: "owner" | "admin" | "manager" | "staff";
};

type MembershipRow = {
  role: WorkspaceSummary["role"];
  businesses: { id: string; name: string; industry: string } | null;
};

/**
 * Workspaces the user is an active member of. RLS guarantees only the
 * caller's memberships are visible; the user filter is for clarity/indexing.
 */
export async function listMyWorkspaces(user: CurrentUser): Promise<WorkspaceSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_members")
    .select("role, businesses ( id, name, industry )")
    .eq("user_id", user.id)
    .eq("invitation_status", "active")
    .order("created_at", { ascending: true })
    .returns<MembershipRow[]>();

  if (error) {
    console.error("[workspaces] failed to list memberships", { code: error.code });
    throw new Error("Could not load your workspaces.");
  }

  return (data ?? [])
    .filter((row): row is MembershipRow & { businesses: NonNullable<MembershipRow["businesses"]> } => !!row.businesses)
    .map((row) => ({
      businessId: row.businesses.id,
      name: row.businesses.name,
      industry: row.businesses.industry,
      role: row.role,
    }));
}
