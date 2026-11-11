"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { rememberActiveWorkspace } from "@/lib/workspaces/active";

export type AcceptState = { status: "idle" | "error"; message?: string };

const ERRORS: Record<string, string> = {
  P0002: "This invitation is no longer valid. Ask for a new one.",
  "55000": "This invitation has expired or was already used. Ask for a new one.",
  "42501": "This invitation was sent to a different email address. Sign in with that address to accept it.",
};

export async function acceptInvitation(token: string, _prev: AcceptState): Promise<AcceptState> {
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const supabase = await createClient();
  const { data: businessId, error } = await supabase.rpc("accept_business_invitation", { p_token: token });
  if (error || !businessId) {
    if (!error || !ERRORS[error.code]) console.error("[invite] accept failed", { code: error?.code });
    return { status: "error", message: (error && ERRORS[error.code]) ?? "Something went wrong. Please try again." };
  }
  // Membership was just created by the database function.
  await rememberActiveWorkspace(businessId);
  redirect("/dashboard?notice=joined-workspace");
}
