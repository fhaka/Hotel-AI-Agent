"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/session";
import {
  companyFromFormData,
  companySchema,
  hotelFromFormData,
  hotelSchema,
  issuesToFieldErrors,
  operationsFromFormData,
  operationsSchema,
} from "@/lib/onboarding/schemas";
import { createWorkspaceArgs, hotelArgs, operationsArgs } from "@/lib/onboarding/rpc-args";
import { nextStep, stepPath } from "@/lib/onboarding/steps";
import { createClient } from "@/lib/supabase/server";
import { isUuid, rememberActiveWorkspace } from "@/lib/workspaces/active";

export type StepFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

type DbError = { code?: string; message?: string } | null;

/** Maps database errors to user-facing messages without leaking internals. */
function dbErrorMessage(error: DbError, context: string): string {
  switch (error?.code) {
    case "42501":
      return "You don't have permission to change this workspace. Only owners and admins can.";
    case "28000":
      return "Your session has expired. Please sign in again.";
    case "54000":
      return "You've reached the maximum number of workspaces for one account. Contact support if you need more.";
    case "55006":
      return "Rooms already have reservations, so they can't be replaced here. Manage them from the Rooms page.";
    case "23505":
      return error.message?.includes("room_number")
        ? "Each room number can only be used once in your hotel."
        : error.message?.includes("room_types")
          ? "Room type names must be unique."
          : "Some of these details are duplicated. Please check and try again.";
    case "22023":
    case "23514":
      return "Some details were not accepted. Please review the highlighted information and try again.";
    default:
      console.error(`[onboarding] ${context} failed`, { code: error?.code });
      return "We couldn't save your changes. Please try again in a moment.";
  }
}

/**
 * When a form is used from the business settings pages (returnTo set), go
 * back there instead of to the next onboarding step. Only paths under
 * /dashboard/business are accepted.
 */
function finish(returnTo: string | null): undefined {
  if (!returnTo) return undefined;
  const path = safeRedirectPath(returnTo, "/dashboard/business");
  const target = path.startsWith("/dashboard/business") ? path.split("?")[0] : "/dashboard/business";
  revalidatePath(target);
  redirect(`${target}?saved=1`);
}

async function authenticated() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/onboarding");
  return user;
}

// ---------------------------------------------------------------------------
// Step 1 (create): creates the workspace; the 7-day trial starts here.
// ---------------------------------------------------------------------------
export async function createWorkspace(_prev: StepFormState, formData: FormData): Promise<StepFormState> {
  await authenticated();
  const parsed = companySchema.safeParse(companyFromFormData(formData));
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { data: businessId, error } = await supabase.rpc("create_business_workspace", createWorkspaceArgs(parsed.data));
  if (error || !businessId) {
    return { status: "error", message: dbErrorMessage(error, "create workspace") };
  }

  // Membership was just created by the function, so this id is verified.
  await rememberActiveWorkspace(businessId);
  redirect(stepPath(businessId, "operations"));
}

// ---------------------------------------------------------------------------
// Step 1 (edit): update the company profile of an existing workspace.
// Industry is fixed after creation (not in the column grants).
// ---------------------------------------------------------------------------
export async function updateCompany(
  businessId: string,
  returnTo: string | null,
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  await authenticated();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };

  const supabase = await createClient();
  const { data: current } = await supabase.from("businesses").select("industry").eq("id", businessId).maybeSingle();
  if (!current) return { status: "error", message: "Unknown workspace." };

  formData.set("industry", current.industry);
  const parsed = companySchema.safeParse(companyFromFormData(formData));
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  }
  const c = parsed.data;
  // RLS limits this update to owners/admins; zero rows updated means no permission.
  const { data, error } = await supabase
    .from("businesses")
    .update({
      name: c.name,
      description: c.description,
      contact_email: c.contactEmail,
      phone: c.phone,
      website: c.website,
      country: c.country,
      city: c.city,
      address: c.address,
      timezone: c.timezone,
      default_language: c.defaultLanguage,
      supported_languages: c.supportedLanguages,
    })
    .eq("id", businessId)
    .select("id");
  if (error) return { status: "error", message: dbErrorMessage(error, "update company") };
  if (!data?.length) return { status: "error", message: dbErrorMessage({ code: "42501" }, "update company") };

  finish(returnTo);
  redirect(stepPath(businessId, nextStep(current.industry, "company")));
}

// ---------------------------------------------------------------------------
// Step 2: operations
// ---------------------------------------------------------------------------
export async function saveOperations(
  businessId: string,
  returnTo: string | null,
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  await authenticated();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const parsed = operationsSchema.safeParse(operationsFromFormData(formData));
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_onboarding_operations", operationsArgs(businessId, parsed.data));
  if (error) return { status: "error", message: dbErrorMessage(error, "save operations") };

  finish(returnTo);
  const { data: business } = await supabase.from("businesses").select("industry").eq("id", businessId).single();
  redirect(stepPath(businessId, business ? nextStep(business.industry, "operations") : "review"));
}

// ---------------------------------------------------------------------------
// Step 3: hotel details and rooms
// ---------------------------------------------------------------------------
export async function saveHotel(
  businessId: string,
  returnTo: string | null,
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  await authenticated();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const parsed = hotelSchema.safeParse(hotelFromFormData(formData));
  if (!parsed.success) {
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_onboarding_hotel", hotelArgs(businessId, parsed.data));
  if (error) return { status: "error", message: dbErrorMessage(error, "save hotel") };
  finish(returnTo);
  redirect(stepPath(businessId, "review"));
}

// ---------------------------------------------------------------------------
// Step 4: finish
// ---------------------------------------------------------------------------
export async function completeOnboarding(businessId: string, _prev: StepFormState): Promise<StepFormState> {
  await authenticated();
  if (!isUuid(businessId)) return { status: "error", message: "Unknown workspace." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding", { p_business_id: businessId });
  if (error) {
    if (error.code === "55000") {
      return { status: "error", message: "Some required steps are not finished yet. Complete them before finishing." };
    }
    return { status: "error", message: dbErrorMessage(error, "complete onboarding") };
  }
  await rememberActiveWorkspace(businessId);
  redirect("/dashboard?notice=onboarding-complete");
}
