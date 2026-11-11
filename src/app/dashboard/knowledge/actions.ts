"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { knowledgeEntrySchema, knowledgeFromFormData } from "@/lib/knowledge/schemas";
import { issuesToFieldErrors } from "@/lib/onboarding/schemas";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type KnowledgeFormState = { status: "idle" | "error"; message?: string; fieldErrors?: Record<string, string> };

const PERMISSION = "Only owners, admins and managers can edit the knowledge base.";

function dbMessage(code: string | undefined, context: string): string {
  if (code === "42501") return PERMISSION;
  if (code === "54000") return "Your knowledge base has reached its size limit. Remove or shorten entries you no longer need.";
  if (code === "23514") return "Some details were not accepted. Please check the entry and try again.";
  console.error(`[knowledge] ${context} failed`, { code });
  return "We couldn't save this entry. Please try again.";
}

async function session() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/knowledge");
  return user;
}

export async function createKnowledgeEntry(businessId: string, _prev: KnowledgeFormState, formData: FormData): Promise<KnowledgeFormState> {
  await session();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const parsed = knowledgeEntrySchema.safeParse(knowledgeFromFormData(formData));
  if (!parsed.success) return { status: "error", fieldErrors: issuesToFieldErrors(parsed.error) };

  const supabase = await createClient();
  // RLS: insert allowed only for owner/admin/manager of this business.
  // created_by and source_type are set by database triggers.
  const { error } = await supabase.from("agent_knowledge").insert({ business_id: businessId, ...parsed.data });
  if (error) return { status: "error", message: dbMessage(error.code, "create") };
  revalidatePath("/dashboard/knowledge");
  redirect(`/dashboard/knowledge?category=${parsed.data.category}&notice=created`);
}

export async function updateKnowledgeEntry(entryId: string, _prev: KnowledgeFormState, formData: FormData): Promise<KnowledgeFormState> {
  await session();
  if (!isUuid(entryId)) return { status: "error", message: "Unknown entry." };
  const parsed = knowledgeEntrySchema.safeParse(knowledgeFromFormData(formData));
  if (!parsed.success) return { status: "error", fieldErrors: issuesToFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("agent_knowledge").update(parsed.data).eq("id", entryId).select("id");
  if (error) return { status: "error", message: dbMessage(error.code, "update") };
  if (!data?.length) return { status: "error", message: PERMISSION };
  revalidatePath("/dashboard/knowledge");
  redirect(`/dashboard/knowledge?category=${parsed.data.category}&notice=updated`);
}

export async function deleteKnowledgeEntry(_prev: KnowledgeFormState, formData: FormData): Promise<KnowledgeFormState> {
  await session();
  const id = formData.get("entryId");
  if (!isUuid(id)) return { status: "error", message: "Unknown entry." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("agent_knowledge").delete().eq("id", id).select("id");
  if (error) return { status: "error", message: dbMessage(error.code, "delete") };
  if (!data?.length) return { status: "error", message: PERMISSION };
  revalidatePath("/dashboard/knowledge");
  redirect("/dashboard/knowledge?notice=deleted");
}
