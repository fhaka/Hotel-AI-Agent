"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type ResolveState = { status: "idle" | "error" | "success"; message?: string };

export async function resolveConversation(conversationId: string, _prev: ResolveState): Promise<ResolveState> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/conversations");
  if (!isUuid(conversationId)) return { status: "error", message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_conversation", { p_conversation_id: conversationId });
  if (error) return { status: "error", message: error.code === "P0002" ? "Conversation not found." : "Could not update the conversation." };
  revalidatePath(`/dashboard/conversations/${conversationId}`);
  revalidatePath("/dashboard/conversations");
  return { status: "success", message: "Marked as handled. No further reminders will be sent." };
}
