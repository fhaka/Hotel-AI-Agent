"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { issuesToFieldErrors } from "@/lib/onboarding/schemas";
import { guestDetailsSchema } from "@/lib/reservations/schemas";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type GuestState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string> };

export async function updateGuest(guestId: string, _prev: GuestState, formData: FormData): Promise<GuestState> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/guests");
  if (!isUuid(guestId)) return { status: "error", message: "Invalid request." };
  const s = (k: string) => String(formData.get(k) ?? "");
  const parsed = guestDetailsSchema
    .extend({ notes: z.string().trim().max(5000).transform((v) => (v === "" ? null : v)) })
    .safeParse({ fullName: s("fullName"), email: s("email"), phone: s("phone"), preferredLanguage: s("preferredLanguage"), notes: s("notes") });
  if (!parsed.success) return { status: "error", fieldErrors: issuesToFieldErrors(parsed.error) };
  const g = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guests")
    .update({ full_name: g.fullName, email: g.email, phone: g.phone, preferred_language: g.preferredLanguage, notes: g.notes })
    .eq("id", guestId)
    .select("id");
  if (error) {
    console.error("[guests] update failed", { code: error.code });
    return { status: "error", message: "Could not save the guest. Please try again." };
  }
  if (!data?.length) return { status: "error", message: "You don't have access to this guest." };
  revalidatePath(`/dashboard/guests/${guestId}`);
  return { status: "success", message: "Guest saved." };
}

/** Right to erasure: anonymises the guest (owner/admin, enforced in the database). */
export async function eraseGuest(businessId: string, guestId: string, _prev: GuestState): Promise<GuestState> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/guests");
  if (!isUuid(businessId) || !isUuid(guestId)) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("erase_guest", { p_business_id: businessId, p_guest_id: guestId });
  if (error) {
    if (error.code === "42501") return { status: "error", message: "Only owners and admins can erase guest data." };
    console.error("[guests] erase failed", { code: error.code });
    return { status: "error", message: "Could not erase the guest's data. Please try again." };
  }
  revalidatePath(`/dashboard/guests/${guestId}`);
  revalidatePath("/dashboard/guests");
  return { status: "success", message: "Personal data erased. Reservations remain without personal details." };
}
