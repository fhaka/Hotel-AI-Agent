"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE, isUuid } from "@/lib/workspaces/active";

export type PrivacyState = { status: "idle" | "error" | "success"; message?: string };

const MESSAGES: Record<string, string> = {
  "42501": "Only the workspace owner can delete it.",
  "22023": "The name you typed doesn't match the workspace name.",
  "55000": "Cancel the subscription in Plan & usage first, so you are not charged for a deleted workspace.",
};

/** Permanently deletes the workspace. Checks (owner, typed name, billing) run in the database. */
export async function deleteWorkspace(businessId: string, _prev: PrivacyState, formData: FormData): Promise<PrivacyState> {
  if (!(await getCurrentUser())) redirect("/auth/login?next=/dashboard/privacy");
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const confirm = String(formData.get("confirmName") ?? "").slice(0, 300);
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_business", { p_business_id: businessId, p_confirm_name: confirm });
  if (error) {
    if (!MESSAGES[error.code]) console.error("[privacy] delete failed", { code: error.code });
    return { status: "error", message: MESSAGES[error.code] ?? "Could not delete the workspace. Please try again." };
  }
  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
  redirect("/dashboard?deleted=1");
}
