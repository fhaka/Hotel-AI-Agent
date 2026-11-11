"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notificationPreferencesSchema, preferencesFromFormData } from "@/lib/automation/preferences";
import { getCurrentUser } from "@/lib/auth/session";
import { issuesToFieldErrors } from "@/lib/onboarding/schemas";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type PrefsState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string> };

export async function savePreferences(businessId: string, _prev: PrefsState, formData: FormData): Promise<PrefsState> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/automations");
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const parsed = notificationPreferencesSchema.safeParse(preferencesFromFormData(formData));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted values.", fieldErrors: issuesToFieldErrors(parsed.error) };
  const supabase = await createClient();
  // RLS: only owners/admins may update business_settings.
  const { data, error } = await supabase
    .from("business_settings")
    .update({ notification_preferences: parsed.data })
    .eq("business_id", businessId)
    .select("business_id");
  if (error) {
    console.error("[automations] save failed", { code: error.code });
    return { status: "error", message: "Could not save. Please try again." };
  }
  if (!data?.length) return { status: "error", message: "Only owners and admins can change automations." };
  revalidatePath("/dashboard/automations");
  return { status: "success", message: "Automation settings saved." };
}
