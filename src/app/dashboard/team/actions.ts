"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { invitationEmail } from "@/lib/email/templates";
import { sendEmail, type SendResult } from "@/lib/email/send";
import { appUrl } from "@/lib/env";
import { issuesToFieldErrors } from "@/lib/onboarding/schemas";
import { createClient } from "@/lib/supabase/server";
import { inviteSchema, roleChangeSchema } from "@/lib/team/schemas";
import { isUuid } from "@/lib/workspaces/active";

export type InviteState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  inviteUrl?: string;
  email?: SendResult["status"];
};

const MESSAGES: Record<string, string> = {
  "42501": "You don't have permission to do that.",
  "22023": "Owners can't be invited directly. Invite them as admin and promote them afterwards.",
  "23505": "That person is already a member of this workspace.",
  "23514": "A workspace must always keep at least one owner.",
  "54000": "Your plan's seat limit is reached (pending invitations count too). Upgrade or remove someone first.",
  "54001": "Your plan is not active, so you can't invite new members. Choose a plan to continue.",
  P0002: "That invitation or member no longer exists.",
};

function message(code: string | undefined, context: string) {
  if (code && MESSAGES[code]) return MESSAGES[code];
  console.error(`[team] ${context} failed`, { code });
  return "Something went wrong. Please try again.";
}

async function requireSession() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/team");
  return user;
}

export async function inviteMember(businessId: string, _prev: InviteState, formData: FormData): Promise<InviteState> {
  const user = await requireSession();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { status: "error", fieldErrors: issuesToFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_business_invitation", { p_business_id: businessId, p_email: parsed.data.email, p_role: parsed.data.role })
    .single();
  if (error || !data) return { status: "error", message: message(error?.code, "invite") };

  const inviteUrl = appUrl(`/invite/${data.token}`);
  const [{ data: business }, { data: profile }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", businessId).single(),
    supabase.from("profiles").select("full_name").eq("id", user.id).single(),
  ]);
  const email = invitationEmail({
    businessName: business?.name ?? "a HotelAI workspace",
    inviterName: profile?.full_name ?? null,
    role: parsed.data.role,
    acceptUrl: inviteUrl,
    expiresAt: new Date(data.expires_at),
  });
  const sent = await sendEmail({
    to: parsed.data.email,
    ...email,
    idempotencyKey: `invitation:${data.invitation_id}`,
    tags: [{ name: "type", value: "invitation" }],
  });

  revalidatePath("/dashboard/team");
  return {
    status: "success",
    inviteUrl,
    email: sent.status,
    message:
      sent.status === "sent"
        ? `Invitation emailed to ${parsed.data.email}.`
        : sent.status === "not_configured"
          ? "Invitation created. Email sending is not configured yet, so share the link below with them directly."
          : "Invitation created, but the email could not be sent. Share the link below with them directly.",
  };
}

export type SimpleState = { status: "idle" | "error" | "success"; message?: string };

export async function changeMemberRole(businessId: string, _prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const parsed = roleChangeSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!isUuid(businessId) || !parsed.success) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_member_role", {
    p_business_id: businessId,
    p_user_id: parsed.data.userId,
    p_new_role: parsed.data.role,
  });
  if (error) return { status: "error", message: message(error.code, "role change") };
  revalidatePath("/dashboard/team");
  return { status: "success", message: "Role updated." };
}

export async function removeMember(businessId: string, _prev: SimpleState, formData: FormData): Promise<SimpleState> {
  const user = await requireSession();
  const userId = formData.get("userId");
  if (!isUuid(businessId) || !isUuid(userId)) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_business_member", { p_business_id: businessId, p_user_id: userId });
  if (error) return { status: "error", message: message(error.code, "remove member") };
  if (userId === user.id) redirect("/dashboard?notice=left-workspace");
  revalidatePath("/dashboard/team");
  return { status: "success", message: "Member removed." };
}

export async function revokeInvitation(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const id = formData.get("invitationId");
  if (!isUuid(id)) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_business_invitation", { p_invitation_id: id });
  if (error) return { status: "error", message: message(error.code, "revoke") };
  revalidatePath("/dashboard/team");
  return { status: "success", message: "Invitation revoked." };
}
