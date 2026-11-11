"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type AccountState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string> };

const profileSchema = z.object({ fullName: z.string().trim().min(2, "Enter your full name").max(200, "Name is too long") });

export async function updateProfile(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/settings");
  const parsed = profileSchema.safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) return { status: "error", fieldErrors: { fullName: parsed.error.issues[0].message } };
  const supabase = await createClient();
  // RLS: users can only update their own profile row.
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", user.id);
  if (error) {
    console.error("[account] profile update failed", { code: error.code });
    return { status: "error", message: "Could not save your name. Please try again." };
  }
  revalidatePath("/dashboard", "layout");
  return { status: "success", message: "Your name has been updated." };
}

export async function sendPasswordResetLink(_prev: AccountState): Promise<AccountState> {
  const user = await getCurrentUser();
  if (!user?.email) redirect("/auth/login?next=/dashboard/settings");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: appUrl("/auth/callback?next=/auth/reset-password"),
  });
  if (error) {
    if (error.status === 429) return { status: "error", message: "Please wait a minute before requesting another email." };
    console.error("[account] reset email failed", { code: error.code });
    return { status: "error", message: "Could not send the email. Please try again." };
  }
  return { status: "success", message: `We sent a password change link to ${user.email}.` };
}
