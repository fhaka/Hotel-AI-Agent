"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { createPaddleProvider, paddleEnvironment } from "@/lib/billing/paddle";
import { priceIdFor, readPriceMap } from "@/lib/billing/prices";
import type { CheckoutConfig } from "@/lib/billing/provider";
import { appUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

export type BillingActionState = { status: "idle" | "error" | "success"; message?: string; checkout?: CheckoutConfig };

const planInput = z.object({
  planId: z.enum(["basic", "growth", "business"]),
  interval: z.enum(["month", "year"]),
});

async function requireOwner(businessId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/dashboard/billing");
  if (!isUuid(businessId)) return { user, ok: false as const, message: "Unknown workspace." };
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .eq("invitation_status", "active")
    .maybeSingle();
  if (m?.role !== "owner") return { user, ok: false as const, message: "Only the workspace owner can manage billing." };
  return { user, ok: true as const, supabase };
}

/**
 * Prepares a Paddle checkout. Creates a server-side checkout session; only
 * its random id goes to the browser (customData.checkout_id). Nothing about
 * the subscription changes until Paddle's signed webhook arrives.
 */
export async function startCheckout(businessId: string, _prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const auth = await requireOwner(businessId);
  if (!auth.ok) return { status: "error", message: auth.message };
  const parsed = planInput.safeParse({ planId: formData.get("planId"), interval: formData.get("interval") });
  if (!parsed.success) return { status: "error", message: "Choose a plan and billing period." };

  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const priceId = priceIdFor(readPriceMap(process.env), parsed.data.planId, parsed.data.interval);
  if (!clientToken || !priceId || !process.env.PADDLE_WEBHOOK_SECRET) {
    return { status: "error", message: "Online payment is not configured yet. Please contact support to subscribe." };
  }

  const { data: checkoutId, error } = await auth.supabase.rpc("create_checkout_session", {
    p_business_id: businessId,
    p_plan_id: parsed.data.planId,
    p_interval: parsed.data.interval,
    p_provider: "paddle",
    p_provider_price_id: priceId,
  });
  if (error || !checkoutId) {
    if (error?.code === "55000") return { status: "error", message: "You already have a paid subscription. Use “Change plan” instead." };
    if (error?.code === "54000") return { status: "error", message: "Too many checkout attempts today. Please try again tomorrow." };
    console.error("[billing] create_checkout_session failed", { code: error?.code });
    return { status: "error", message: "Could not start the checkout. Please try again." };
  }

  return {
    status: "success",
    checkout: {
      provider: "paddle",
      environment: paddleEnvironment(),
      clientToken,
      priceId,
      checkoutId,
      customerEmail: auth.user.email,
      successUrl: appUrl("/dashboard/billing?checkout=processing"),
    },
  };
}

async function currentSubscription(supabase: Awaited<ReturnType<typeof createClient>>, businessId: string) {
  const { data } = await supabase
    .from("subscriptions")
    .select("status, plan_id, billing_interval, provider_customer_id, provider_subscription_id")
    .eq("business_id", businessId)
    .single();
  return data;
}

export async function changePlan(businessId: string, _prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const auth = await requireOwner(businessId);
  if (!auth.ok) return { status: "error", message: auth.message };
  const parsed = planInput.safeParse({ planId: formData.get("planId"), interval: formData.get("interval") });
  if (!parsed.success) return { status: "error", message: "Choose a plan and billing period." };
  const sub = await currentSubscription(auth.supabase, businessId);
  if (!sub?.provider_subscription_id || !["active", "past_due"].includes(sub.status)) {
    return { status: "error", message: "There is no active paid subscription to change." };
  }
  const priceId = priceIdFor(readPriceMap(process.env), parsed.data.planId, parsed.data.interval);
  if (!priceId) return { status: "error", message: "That plan is not available for online payment yet." };
  try {
    await createPaddleProvider().changePlan(sub.provider_subscription_id, priceId);
  } catch (err) {
    console.error("[billing] plan change failed", { name: err instanceof Error ? err.name : "unknown" });
    return { status: "error", message: "Paddle could not change the plan. No changes were made." };
  }
  revalidatePath("/dashboard/billing");
  return { status: "success", message: "Plan change requested. It takes effect as soon as Paddle confirms it (usually within a minute); refresh to see it." };
}

export async function cancelSubscription(businessId: string, _prev: BillingActionState): Promise<BillingActionState> {
  const auth = await requireOwner(businessId);
  if (!auth.ok) return { status: "error", message: auth.message };
  const sub = await currentSubscription(auth.supabase, businessId);
  if (!sub?.provider_subscription_id) return { status: "error", message: "There is no paid subscription to cancel." };
  try {
    await createPaddleProvider().cancelAtPeriodEnd(sub.provider_subscription_id);
  } catch (err) {
    console.error("[billing] cancel failed", { name: err instanceof Error ? err.name : "unknown" });
    return { status: "error", message: "Paddle could not cancel the subscription. Nothing was changed." };
  }
  revalidatePath("/dashboard/billing");
  return { status: "success", message: "Cancellation requested. You keep access until the end of the current billing period; your data is not deleted." };
}

export async function openBillingPortal(businessId: string): Promise<void> {
  const auth = await requireOwner(businessId);
  if (!auth.ok) redirect("/dashboard/billing?portal=forbidden");
  const sub = await currentSubscription(auth.supabase, businessId);
  if (!sub?.provider_customer_id) redirect("/dashboard/billing?portal=unavailable");
  let url: string;
  try {
    url = await createPaddleProvider().portalUrl(sub.provider_customer_id, sub.provider_subscription_id);
  } catch (err) {
    console.error("[billing] portal session failed", { name: err instanceof Error ? err.name : "unknown" });
    redirect("/dashboard/billing?portal=error");
  }
  redirect(url);
}
