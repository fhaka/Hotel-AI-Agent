import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple monthly or annual plans for AI receptionists and reservation assistants. 7-day free trial, no card required.",
};

const FEATURE_LABELS: Record<string, string> = {
  website_receptionist: "AI website receptionist",
  reservation_assistant: "AI reservation assistant",
  voice_receptionist: "AI phone receptionist (phone number set up with you)",
  knowledge_base: "Business knowledge base",
  automations: "Automated reminders & workflows",
  calendar: "Reservation calendar",
  basic_reports: "Basic reports",
  advanced_reports: "Advanced reports",
  integrations: "Advanced integrations",
  email_support: "Email support",
  priority_support: "Priority support",
};

const FAQ = [
  ["Do I need a card for the trial?", "No. Your 7-day trial starts when you create your workspace and needs no payment details."],
  ["What happens after the trial?", "Agents pause until you choose a plan. You can still sign in, see your data and subscribe at any time; nothing is deleted."],
  ["Can I change or cancel my plan?", "Yes. Upgrades and downgrades are prorated. If you cancel, you keep access until the end of the paid period."],
  ["Who handles payments?", "Payments, invoices and sales tax are handled by our payment provider, Paddle. We never see or store your card details."],
];

export default function PricingPage() {
  return (
    <div className="flex flex-1 flex-col bg-surface">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <h1 className="text-4xl font-semibold tracking-tight">Plans that grow with your property</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
            Start with a 7-day free trial, no card required. Pay monthly, or annually and get two months free.
          </p>
        </section>
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <Suspense fallback={<div className="py-16 text-center"><Spinner label="Loading plans" /></div>}>
            <Plans />
          </Suspense>
          <p className="mt-6 text-center text-xs text-subtle">Prices exclude VAT/sales tax, which is calculated at checkout where applicable.</p>
        </section>
        <section className="border-t border-border bg-canvas">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Billing questions</h2>
            <dl className="mt-6 space-y-6">
              {FAQ.map(([q, a]) => (
                <div key={q}>
                  <dt className="font-semibold">{q}</dt>
                  <dd className="mt-2 text-sm leading-6 text-muted">{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

/** Plans come from the database (the same rows the app bills against). */
async function Plans() {
  await connection();
  const supabase = await createClient();
  const { data: plans, error } = await supabase
    .from("plans")
    .select("id, name, description, monthly_price_cents, annual_price_cents, currency, features, usage_limits")
    .eq("is_active", true)
    .order("sort_order");
  if (error || !plans?.length) {
    return <p className="text-center text-sm text-muted">Pricing is temporarily unavailable. Please try again shortly.</p>;
  }
  const fmt = (cents: number, currency: string) =>
    new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {plans.map((p, i) => {
        const limits = (p.usage_limits ?? {}) as Record<string, number>;
        const features = Array.isArray(p.features) ? (p.features as string[]) : [];
        const highlighted = i === 1;
        return (
          <Card key={p.id} className={highlighted ? "flex flex-col border-brand-600 p-8 ring-1 ring-brand-600" : "flex flex-col p-8"}>
            {highlighted ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-600">Most popular</p> : null}
            <h2 className="text-xl font-semibold">{p.name}</h2>
            <p className="mt-2 text-sm text-muted">{p.description}</p>
            <p className="mt-6 text-4xl font-semibold">
              {fmt(p.monthly_price_cents, p.currency)}
              <span className="text-base font-normal text-muted">/month</span>
            </p>
            <p className="text-sm text-muted">or {fmt(p.annual_price_cents, p.currency)} per year</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {limits.ai_messages_per_month ? <li>{limits.ai_messages_per_month.toLocaleString("en")} AI messages per month</li> : null}
              {limits.members ? <li>Up to {limits.members} team members</li> : null}
              {features.map((f) => (
                <li key={f} className="text-muted">✓ {FEATURE_LABELS[f] ?? f}</li>
              ))}
            </ul>
            <ButtonLink href="/auth/sign-up" variant={highlighted ? "primary" : "secondary"} className="mt-8 w-full">
              Start free trial
            </ButtonLink>
          </Card>
        );
      })}
    </div>
  );
}
