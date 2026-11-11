import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth/session";
import type { Database } from "@/lib/supabase/database.types";

type Role = Database["public"]["Enums"]["business_role"];
type Industry = Database["public"]["Enums"]["industry"];

export type WorkspaceSummary = {
  businessId: string;
  name: string;
  industry: Industry;
  role: Role;
  onboardingCompleted: boolean;
  onboardingState: unknown;
};

/**
 * Workspaces the user is an active member of. RLS guarantees only the
 * caller's memberships are visible; the user filter is for clarity/indexing.
 */
export async function listMyWorkspaces(user: CurrentUser): Promise<WorkspaceSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_members")
    .select("role, created_at, businesses ( id, name, industry, onboarding_completed_at, onboarding_state )")
    .eq("user_id", user.id)
    .eq("invitation_status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[workspaces] failed to list memberships", { code: error.code });
    throw new Error("Could not load your workspaces.");
  }

  return (data ?? []).flatMap((row) =>
    row.businesses
      ? [
          {
            businessId: row.businesses.id,
            name: row.businesses.name,
            industry: row.businesses.industry,
            role: row.role,
            onboardingCompleted: row.businesses.onboarding_completed_at !== null,
            onboardingState: row.businesses.onboarding_state,
          },
        ]
      : [],
  );
}

export const ADMIN_ROLES: readonly Role[] = ["owner", "admin"];
