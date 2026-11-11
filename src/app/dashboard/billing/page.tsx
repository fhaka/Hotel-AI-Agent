import type { Metadata } from "next";
import Link from "next/link";
import { cancelSubscription, changePlan, openBillingPortal, startCheckout } from "@/app/dashboard/billing/actions";
import { PlanPicker, type PlanCard } from "@/components/billing/plan-picker";
import { SubscriptionControls } from "@/components/billing/subscription-controls";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UsageMeter } from "@/components/ui/usage-meter";
import { billingConfigStatus } from "@/lib/billing/paddle";
import { priceIdFor } from "@/lib/billing/prices";
import { formatInZone } from "@/lib/billing/trial";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Plan & usage" };

const FEATURE_LABELS: Record<string, string> = {
  website_receptionist: "AI website receptionist",
  reservation_assistant: "AI reservation assistant",
  voice_receptionist: "AI voice receptionist (when available)",
  knowledge_base: "Business knowledge base",
  automations: "Automated reminders & workflows",
  calendar: "Reservation calendar",
  basic_reports: "Basic reports",
  advanced_reports: "Advanced reports",
  integrations: "Advanced integrations",
  email_support: "Email support",
  priority_support: "Priority support",
};

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  trialing: { label: "Free trial", tone: "success" },
  active: { label: "Active", tone: "success" },
  past_due: { label: "Payment failed", tone: "warning" },
  canceled: { label: "Canceled", tone: "warning" },
  paused: { label: "Paused", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  incomplete: { label: "No plan", tone: "danger" },
};

const PORTAL_ERRORS: Record<string, string> = {
  forbidden: "Only the workspace owner can manage payment details.",
  unavailable: "Payment details are available once you have a paid subscription.",
  error: "Paddle's customer portal could not be opened. Please try again.",
};

const EVENT_LABELS: Record<string, string> = {
  "subscription.created": "Subscription created",
  "subscription.activated": "Subscription activated",
  "subscription.updated": "Subscription updated",
  "subscription.past_due": "Payment overdue",
  "subscription.paused": "Subscription paused",
  "subscription.resumed": "Subscription resumed",
  "subscription.canceled": "Subscription canceled",
  "transaction.completed": "Payment completed",
  "transaction.payment_failed": "Payment failed",
  "adjustment.created": "Refund or credit",
  "adjustment.updated": "Refund or credit updated",
};

export default async function BillingPage({ searchParams }: PageProps<"/dashboard/billing">) {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/billing");
  if (!ent.can("billing.view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Plan & usage</h1>
        <Alert tone="info">Only owners and admins can view billing details.</Alert>
      </div>
    );
  }
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: plans }, { data: business }, { data: sub }, { data: history }] = await Promise.all([
    supabase.from("plans").select("id, name, description, monthly_price_cents, annual_price_cents, currency, features, usage_limits").eq("is_active", true).order("sort_order"),
    supabase.from("businesses").select("timezone").eq("id", workspace.businessId).single(),
    supabase.from("subscriptions").select("status, provider_subscription_id, provider_customer_id, cancel_at_period_end, current_period_end").eq("business_id", workspace.businessId).single(),
    supabase.from("subscription_events").select("id, event_type, outcome, status, plan_id, billing_interval, occurred_at").eq("business_id", workspace.businessId).order("occurred_at", { ascending: false }).limit(20),
  ]);
  const tz = business?.timezone ?? "UTC";
  const s = ent.snapshot;
  const config = billingConfigStatus();
  const status = STATUS[s.subscription_status ?? "incomplete"];
  const trialExpired = s.reason === "trial_expired";
  const paid = Boolean(sub?.provider_subscription_id) && ["active", "past_due", "paused"].includes(sub?.status ?? "");
  const canManage = ent.can("billing.manage");
  const mode: "checkout" | "change" | "unavailable" = !config.checkoutConfigured ? "unavailable" : paid ? "change" : "checkout";
  const periodEnd = s.period_end ? new Date(s.period_end) : null;
  const processing = sp.checkout === "processing";
  const portalError = typeof sp.portal === "string" ? PORTAL_ERRORS[sp.portal] : undefined;

  const cards: PlanCard[] = (plans ?? []).map((p) => {
    const limits = (p.usage_limits ?? {}) as Record<string, number>;
    const id = p.id as PlanCard["id"];
    return {
      id,
      name: p.name,
      description: p.description,
      monthlyCents: p.monthly_price_cents,
      annualCents: p.annual_price_cents,
      currency: p.currency,
      messagesPerMonth: limits.ai_messages_per_month ?? null,
      members: limits.members ?? null,
      features: (Array.isArray(p.features) ? (p.features as string[]) : []).map((f) => FEATURE_LABELS[f] ?? f),
      purchasable: { month: Boolean(priceIdFor(config.prices, id, "month")), year: Boolean(priceIdFor(config.prices, id, "year")) },
    };
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Plan & usage</h1>

      {processing && !paid ? (
        <Alert tone="info" title="Payment is being confirmed">
          Paddle has received your checkout. Your plan activates as soon as Paddle sends us the verified payment
          confirmation, usually within a minute. <Link href="/dashboard/billing" className="font-medium underline">Refresh</Link>
        </Alert>
      ) : null}
      {processing && paid ? <Alert tone="success">Thank you! Your subscription is active.</Alert> : null}
      {portalError ? <Alert tone="danger">{portalError}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Current plan</h2>
            <Badge tone={trialExpired ? "danger" : status.tone}>{trialExpired ? "Trial ended" : status.label}</Badge>
          </div>
          <p className="text-2xl font-semibold">
            {ent.planName ?? "—"}
            {s.billing_interval && !s.is_trial ? <span className="text-sm font-normal text-muted"> · billed {s.billing_interval === "year" ? "annually" : "monthly"}</span> : null}
          </p>
          {s.is_trial && s.trial_ends_at ? (
            <p className="text-sm text-muted">
              {trialExpired ? "Your trial ended on " : "Your free trial includes the Growth plan features until "}
              {formatInZone(new Date(s.trial_ends_at), tz)}.
            </p>
          ) : null}
          {paid && sub?.current_period_end ? (
            <p className="text-sm text-muted">
              {sub.cancel_at_period_end ? "Ends" : "Renews"} on {formatInZone(new Date(sub.current_period_end), tz)}.
            </p>
          ) : null}
          {s.subscription_status === "past_due" ? (
            <Alert tone="warning">Your last payment failed. Paddle will retry; please update your payment details to avoid interruption.</Alert>
          ) : null}
          {s.subscription_status === "incomplete" ? <p className="text-sm text-muted">No free trial is available for this workspace (one trial per account).</p> : null}
          {!ent.accessActive ? <Alert tone="danger">{ent.inactiveReason?.message} Your data stays available and nothing is deleted.</Alert> : null}
          {paid && canManage && config.serverConfigured ? (
            <SubscriptionControls
              cancelAction={cancelSubscription.bind(null, workspace.businessId)}
              portalAction={openBillingPortal.bind(null, workspace.businessId)}
              canCancel={!sub?.cancel_at_period_end}
            />
          ) : null}
        </Card>

        <Card className="space-y-5 p-6">
          <div>
            <h2 className="text-base font-semibold">Usage this period</h2>
            {periodEnd ? <p className="text-xs text-muted">Resets or ends {formatInZone(periodEnd, tz)}</p> : null}
          </div>
          <UsageMeter label="AI messages" used={ent.usage.aiMessages.used} limit={ent.usage.aiMessages.limit} />
          <UsageMeter label="AI tokens" used={ent.usage.aiTokens.used} limit={ent.usage.aiTokens.limit} />
          <UsageMeter label="Team seats" used={ent.usage.members.used} limit={ent.usage.members.limit} />
          {(ent.usage.voiceMinutes.limit ?? 0) > 0 ? (
            <UsageMeter label="Voice minutes" used={ent.usage.voiceMinutes.used} limit={ent.usage.voiceMinutes.limit} unit="min" />
          ) : null}
        </Card>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{paid ? "Change plan" : "Choose a plan"}</h2>
        {mode === "unavailable" ? (
          <Alert tone="info" title="Online payment is not set up yet">
            Plans can&apos;t be purchased online on this server yet (payment provider keys and price IDs are not configured).
            No payment details are requested.
          </Alert>
        ) : null}
        {!canManage && mode !== "unavailable" ? <Alert tone="info">Only the workspace owner can purchase or change plans.</Alert> : null}
        <PlanPicker
          plans={cards}
          current={{ planId: paid ? (s.plan_id ?? null) : null, interval: paid ? (s.billing_interval ?? null) : null, paid }}
          mode={mode}
          canManage={canManage}
          checkoutAction={startCheckout.bind(null, workspace.businessId)}
          changeAction={changePlan.bind(null, workspace.businessId)}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Billing history</h2>
        {(history ?? []).length === 0 ? (
          <p className="text-sm text-muted">No billing events yet.</p>
        ) : (
          <Card>
            <ul className="divide-y divide-border text-sm">
              {(history ?? []).map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span>
                    {EVENT_LABELS[h.event_type] ?? h.event_type}
                    {h.plan_id ? <span className="text-muted"> · {h.plan_id}{h.billing_interval ? ` (${h.billing_interval}ly)` : ""}</span> : null}
                    {h.outcome === "conflict" ? <Badge tone="danger">Needs review</Badge> : null}
                  </span>
                  <span className="text-muted">{formatInZone(new Date(h.occurred_at), tz)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="text-xs text-muted">Invoices and receipts are available in Paddle&apos;s customer portal (“Manage payment details & invoices”).</p>
      </section>
    </div>
  );
}
