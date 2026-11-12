"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { E164, FEATURES, parseLimits, planSchema, retentionSchema, suspensionSchema, trialSettingsSchema, AGENT_TYPES } from "@/lib/admin/schemas";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

/**
 * Operator actions. Authorization is enforced by each database function
 * (platform_admins check + audit log); these actions only validate input and
 * translate errors.
 */
export type AdminState = { status: "idle" | "error" | "success"; message?: string };

const MESSAGES: Record<string, string> = {
  "42501": "You are not a platform administrator.",
  "22023": "Some values are not valid.",
  P0002: "Not found.",
  "23505": "That phone number is already assigned to another workspace.",
  "23514": "Use international format, e.g. +355691234567.",
};

async function rpc(fn: string, args: Record<string, unknown>, revalidate: string[]): Promise<AdminState> {
  if (!(await getCurrentUser())) redirect("/auth/login?next=/admin");
  const supabase = await createClient();
  const { error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ error: { code: string } | null }>)(fn, args);
  if (error) {
    if (!MESSAGES[error.code]) console.error("[admin] action failed", { fn, code: error.code });
    return { status: "error", message: MESSAGES[error.code] ?? "Could not save. Please try again." };
  }
  for (const path of revalidate) revalidatePath(path);
  return { status: "success", message: "Saved." };
}

const fail = (message: string): AdminState => ({ status: "error", message });

export async function setSuspension(businessId: string, _prev: AdminState, formData: FormData): Promise<AdminState> {
  if (!isUuid(businessId)) return fail("Unknown business.");
  const parsed = suspensionSchema.safeParse({ suspended: formData.get("suspended"), reason: formData.get("reason") ?? undefined });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  return rpc("admin_set_business_suspension", { p_business_id: businessId, p_suspended: parsed.data.suspended, p_reason: parsed.data.reason ?? null }, [
    `/admin/businesses/${businessId}`,
    "/admin/businesses",
  ]);
}

export async function setLimitOverrides(businessId: string, _prev: AdminState, formData: FormData): Promise<AdminState> {
  if (!isUuid(businessId)) return fail("Unknown business.");
  const parsed = parseLimits(formData);
  if (!parsed.ok) return fail("Limits must be whole numbers (leave empty for no override).");
  return rpc("admin_set_limit_overrides", { p_business_id: businessId, p_overrides: parsed.limits }, [`/admin/businesses/${businessId}`]);
}

const kindSchema = z.enum(["voice", "whatsapp"]);

export async function assignNumber(businessId: string, _prev: AdminState, formData: FormData): Promise<AdminState> {
  if (!isUuid(businessId)) return fail("Unknown business.");
  const kind = kindSchema.safeParse(formData.get("kind"));
  const address = String(formData.get("address") ?? "").replace(/[\s()-]/g, "");
  if (!kind.success) return fail("Choose phone or WhatsApp.");
  if (!E164.test(address)) return fail(MESSAGES["23514"]);
  return rpc("admin_assign_channel_address", { p_business_id: businessId, p_kind: kind.data, p_address: address }, [`/admin/businesses/${businessId}`]);
}

export async function releaseNumber(businessId: string, kind: "voice" | "whatsapp", _prev: AdminState): Promise<AdminState> {
  if (!isUuid(businessId) || !kindSchema.safeParse(kind).success) return fail("Unknown channel.");
  return rpc("admin_release_channel_address", { p_business_id: businessId, p_kind: kind }, [`/admin/businesses/${businessId}`]);
}

export async function updatePlan(planId: string, _prev: AdminState, formData: FormData): Promise<AdminState> {
  if (!/^[a-z0-9_]{2,40}$/.test(planId)) return fail("Unknown plan.");
  const limits = parseLimits(formData);
  if (!limits.ok) return fail("Limits must be whole numbers (leave empty for unlimited).");
  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    isActive: formData.get("isActive") === "on",
    features: FEATURES.filter((f) => formData.get(`feature.${f}`) === "on"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  return rpc(
    "admin_update_plan",
    {
      p_plan_id: planId,
      p_name: parsed.data.name,
      p_description: parsed.data.description ?? null,
      p_usage_limits: limits.limits,
      p_features: parsed.data.features,
      p_is_active: parsed.data.isActive,
    },
    ["/admin/plans", "/pricing"],
  );
}

export async function updateTrialSettings(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const limits = parseLimits(formData);
  if (!limits.ok) return fail("Limits must be whole numbers.");
  const parsed = trialSettingsSchema.safeParse({
    days: formData.get("days"),
    max_trials_per_user: formData.get("max_trials_per_user"),
    plan_id: formData.get("plan_id"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  return rpc("admin_update_setting", { p_key: "trial", p_value: { ...parsed.data, usage_limits: limits.limits } }, ["/admin/settings"]);
}

export async function updateAgentAvailability(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const value = Object.fromEntries(AGENT_TYPES.map((t) => [t, formData.get(`agent.${t}`) === "on"]));
  return rpc("admin_update_setting", { p_key: "agent_availability", p_value: value }, ["/admin/settings"]);
}

export async function updateRetention(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const parsed = retentionSchema.safeParse(Object.fromEntries(Object.keys(retentionSchema.shape).map((k) => [k, formData.get(k)])));
  if (!parsed.success) return fail(`${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`);
  const { playground_retention_days, conversation_retention_days, ...rest } = parsed.data;
  const a = await rpc("admin_update_setting", { p_key: "agent_runtime", p_value: { playground_retention_days, conversation_retention_days } }, []);
  if (a.status === "error") return a;
  return rpc("admin_update_setting", { p_key: "retention", p_value: rest }, ["/admin/settings"]);
}

export async function updateWorkspaceLimit(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const parsed = z.coerce.number().int().min(1).max(100).safeParse(formData.get("max_created_per_user"));
  if (!parsed.success) return fail("Enter a whole number between 1 and 100.");
  return rpc("admin_update_setting", { p_key: "workspaces", p_value: { max_created_per_user: parsed.data } }, ["/admin/settings"]);
}
