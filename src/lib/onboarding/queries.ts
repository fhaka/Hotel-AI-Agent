import "server-only";
import { notFound } from "next/navigation";
import type { CurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";
import { ADMIN_ROLES } from "@/lib/workspaces/queries";
import { readCompletedSteps } from "./steps";

/**
 * Loads everything the onboarding wizard needs for one business. The
 * business id comes from the URL, so access is verified here: the user must
 * be an active owner/admin. RLS independently restricts every query.
 */
export async function getOnboardingContext(user: CurrentUser, businessId: string) {
  if (!isUuid(businessId)) notFound();
  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .eq("invitation_status", "active")
    .maybeSingle();

  // Same response for "does not exist" and "not a member": no information leak.
  if (!membership) notFound();
  if (!ADMIN_ROLES.includes(membership.role)) return { access: "denied" as const, role: membership.role };

  const [business, settings, knowledge, roomTypes, rooms] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", businessId).single(),
    supabase.from("business_settings").select("*").eq("business_id", businessId).single(),
    supabase
      .from("agent_knowledge")
      .select("id, title, content, category")
      .eq("business_id", businessId)
      .eq("source_type", "onboarding")
      .in("category", ["services", "faq"])
      .order("created_at", { ascending: true }),
    supabase.from("room_types").select("*").eq("business_id", businessId).order("created_at", { ascending: true }),
    supabase.from("rooms").select("room_type_id, room_number").eq("business_id", businessId).order("room_number"),
  ]);

  for (const result of [business, settings, knowledge, roomTypes, rooms]) {
    if (result.error) {
      console.error("[onboarding] failed to load context", { code: result.error.code });
      throw new Error("Could not load your workspace setup.");
    }
  }

  return {
    access: "granted" as const,
    role: membership.role,
    business: business.data!,
    settings: settings.data!,
    services: (knowledge.data ?? []).filter((k) => k.category === "services"),
    faqs: (knowledge.data ?? []).filter((k) => k.category === "faq"),
    roomTypes: (roomTypes.data ?? []).map((rt) => ({
      ...rt,
      roomNumbers: (rooms.data ?? []).filter((r) => r.room_type_id === rt.id).map((r) => r.room_number),
    })),
    completedSteps: readCompletedSteps(business.data!.onboarding_state),
  };
}

export type OnboardingContext = Extract<Awaited<ReturnType<typeof getOnboardingContext>>, { access: "granted" }>;
