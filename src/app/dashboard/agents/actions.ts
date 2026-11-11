"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { agentFormFromFormData, agentFormSchema } from "@/lib/agents/config";
import { issuesToFieldErrors } from "@/lib/onboarding/schemas";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type AgentFormState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string> };

export async function updateAgent(agentId: string, _prev: AgentFormState, formData: FormData): Promise<AgentFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/agents");
  if (!isUuid(agentId)) return { status: "error", message: "Unknown agent." };

  const parsed = agentFormSchema.safeParse(agentFormFromFormData(formData));
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  // RLS restricts this to owners/admins of the agent's business; the column
  // grants only allow these four columns; a trigger blocks enabling
  // unavailable agents.
  const { data, error } = await supabase
    .from("agents")
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      enabled: parsed.data.enabled,
      system_configuration: parsed.data.config,
    })
    .eq("id", agentId)
    .select("id");

  if (error) {
    if (error.code === "22023") return { status: "error", message: "This agent isn't available for your workspace yet, so it can't be turned on." };
    console.error("[agents] update failed", { code: error.code });
    return { status: "error", message: "We couldn't save the agent. Please try again." };
  }
  if (!data?.length) return { status: "error", message: "You don't have permission to configure agents. Only owners and admins can." };

  revalidatePath("/dashboard/agents");
  return { status: "success", message: "Agent settings saved." };
}
