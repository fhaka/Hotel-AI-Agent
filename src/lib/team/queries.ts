import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Members of a business with profile details (RLS: only for co-members). */
export async function listMembers(businessId: string) {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("business_members")
    .select("user_id, role, invitation_status, created_at")
    .eq("business_id", businessId)
    .eq("invitation_status", "active")
    .order("created_at");
  if (error) throw new Error("Could not load team members.");
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  return (members ?? []).map((m) => {
    const p = profiles?.find((x) => x.id === m.user_id);
    return { userId: m.user_id, role: m.role, joinedAt: m.created_at, name: p?.full_name ?? null, email: p?.email ?? null };
  });
}

/** Pending invitations (RLS: owners/admins only; others get an empty list). */
export async function listPendingInvitations(businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_invitations")
    .select("id, email, role, expires_at, created_at")
    .eq("business_id", businessId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return data ?? [];
}
