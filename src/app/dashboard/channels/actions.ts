"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { voiceConfigSchema, widgetConfigSchema } from "@/lib/channels/config";
import { getCurrentUser } from "@/lib/auth/session";
import { issuesToFieldErrors } from "@/lib/onboarding/schemas";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type ChannelState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string> };

const MESSAGES: Record<string, string> = {
  "42501": "Only owners and admins can change channels.",
  "55000": "No phone number has been assigned to this workspace yet.",
  "22023": "Some settings are not valid.",
};

async function session() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/channels");
}

async function configure(businessId: string, kind: "website_widget" | "voice" | "whatsapp", enabled: boolean, config: object): Promise<ChannelState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("configure_channel", { p_business_id: businessId, p_kind: kind, p_enabled: enabled, p_config: config as never });
  if (error) {
    if (!MESSAGES[error.code]) console.error("[channels] configure failed", { code: error.code });
    return { status: "error", message: MESSAGES[error.code] ?? "Could not save. Please try again." };
  }
  revalidatePath("/dashboard/channels");
  return { status: "success", message: "Saved." };
}

export async function saveWidget(businessId: string, _prev: ChannelState, formData: FormData): Promise<ChannelState> {
  await session();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const origins = String(formData.get("origins") ?? "")
    .split(/[\s,]+/)
    .map((o) => o.trim())
    .filter(Boolean);
  const color = String(formData.get("accentColor") ?? "").trim();
  const parsed = widgetConfigSchema.safeParse({ allowed_origins: origins, accent_color: color || null });
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  const enabled = formData.get("enabled") === "on";
  if (enabled && parsed.data.allowed_origins.length === 0) {
    return { status: "error", fieldErrors: { allowed_origins: "Add at least one website where the chat may appear." } };
  }
  return configure(businessId, "website_widget", enabled, parsed.data);
}

export async function regenerateKey(businessId: string, _prev: ChannelState): Promise<ChannelState> {
  await session();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_widget_key", { p_business_id: businessId });
  if (error) return { status: "error", message: MESSAGES[error.code] ?? "Could not regenerate the key." };
  revalidatePath("/dashboard/channels");
  return { status: "success", message: "New key created. Update the embed code on your website; the old one stopped working." };
}

export async function saveVoice(businessId: string, _prev: ChannelState, formData: FormData): Promise<ChannelState> {
  await session();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const handoff = String(formData.get("handoffPhone") ?? "").replace(/[\s()-]/g, "");
  const parsed = voiceConfigSchema.safeParse({ language: formData.get("language"), handoff_phone: handoff || null });
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  return configure(businessId, "voice", formData.get("enabled") === "on", parsed.data);
}

export async function saveWhatsapp(businessId: string, _prev: ChannelState, formData: FormData): Promise<ChannelState> {
  await session();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  return configure(businessId, "whatsapp", formData.get("enabled") === "on", {});
}
