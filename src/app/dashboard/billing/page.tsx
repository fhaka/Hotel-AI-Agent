import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UsageMeter } from "@/components/ui/usage-meter";
import { formatInZone } from "@/lib/billing/trial";
import { formatCents } from "@/lib/onboarding/parsing";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Plan & usage" };

const FEATURE_LABELS: Record<string, string> = {
  website_receptionist: "AI website receptionist",
  reservation_assistant: "AI reservation assistant",
  voice_receptionist: "AI voice receptionist (allowance)",
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

export default async function BillingPage() {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/billing");

  if (!ent.can("billing.view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Plan & usage</h1>
        <Alert tone="info">Only owners and admins can view billing details.</Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: plans }, { data: business }] = await Promise.all([
    supabase.from("plans").select("id, name, description, monthly_price_cents, annual_price_cents, currency, features, usage_limits").eq("is_active", true).order("sort_order"),
    supabase.from("businesses").select("timezone").eq("id", workspace.businessId).single(),
  ]);
  const tz = business?.timezone ?? "UTC";
  const s = ent.snapshot;
  const status = STATUS[s.subscription_status ?? "incomplete"];
  const trialExpired = s.reason === "trial_expired";
  const periodEnd = s.period_end ? new Date(s.period_end) : null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Plan & usage</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Current plan</h2>
            <Badge tone={trialExpired ? "danger" : status.tone}>{trialExpired ? "Trial ended" : status.label}</Badge>
          </div>
          <p className="text-2xl font-semibold">{ent.planName ?? "—"}</p>
          {s.is_trial && s.trial_ends_at ? (
            <p className="text-sm text-muted">
              {trialExpired ? "Your trial ended on " : "Your free trial includes the Growth plan features until "}
              {formatInZone(new Date(s.trial_ends_at), tz)}.
            </p>
          ) : null}
          {s.subscription_status === "incomplete" ? (
            <p className="text-sm text-muted">No free trial is available for this workspace (one trial per account).</p>
          ) : null}
          {!ent.accessActive ? (
            <Alert tone="danger">
              {ent.inactiveReason?.message} Your data stays available and nothing is deleted.
            </Alert>
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
        <div>
          <h2 className="text-lg font-semibold">Plans</h2>
          <p className="mt-1 text-sm text-muted">Annual billing costs the same as 10 months.</p>
        </div>
        <Alert tone="info" title="Online checkout is not available yet">
          Paid subscriptions will be purchasable here once payment processing is connected. Until then, your workspace keeps
          working during the free trial, and no payment details are requested.
        </Alert>
        <div className="grid gap-6 lg:grid-cols-3">
          {(plans ?? []).map((p) => {
            const limits = (p.usage_limits ?? {}) as Record<string, number>;
            const features = Array.isArray(p.features) ? (p.features as string[]) : [];
            const current = p.id === s.plan_id && !s.is_trial && ent.accessActive;
            return (
              <Card key={p.id} className={current ? "border-brand-600 p-6 ring-1 ring-brand-600" : "p-6"}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  {current ? <Badge tone="brand">Current</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted">{p.description}</p>
                <p className="mt-4 text-3xl font-semibold">
                  {formatCents(p.monthly_price_cents, p.currency)}
                  <span className="text-sm font-normal text-muted">/month</span>
                </p>
                <p className="text-xs text-muted">or {formatCents(p.annual_price_cents, p.currency)}/year</p>
                <ul className="mt-4 space-y-1 text-sm">
                  {limits.ai_messages_per_month ? <li>{new Intl.NumberFormat("en").format(limits.ai_messages_per_month)} AI messages / month</li> : null}
                  {limits.members ? <li>Up to {limits.members} team members</li> : null}
                  {features.map((f) => (
                    <li key={f} className="text-muted">
                      ✓ {FEATURE_LABELS[f] ?? f}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
