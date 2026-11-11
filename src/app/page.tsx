import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const agents = [
  {
    name: "Website Receptionist",
    status: "Core",
    body: "Answers visitor questions about rooms, policies, opening hours and services using only the information you have configured — and hands complex requests to your team.",
  },
  {
    name: "Reservation Assistant",
    status: "Core",
    body: "Checks real availability from your inventory, quotes prices, collects guest details and creates a booking only after the guest explicitly confirms.",
  },
  {
    name: "Voice Receptionist",
    status: "Planned",
    body: "Answers phone calls with the same knowledge and booking tools. Available once a voice provider integration is connected and tested.",
  },
];

const steps = [
  { title: "Create your account", body: "Register and verify your email address." },
  { title: "Describe your business", body: "Add rooms, policies, FAQs and opening hours in a guided setup." },
  { title: "Test your agents", body: "Chat with your agents in a private playground before going live." },
  { title: "Go live", body: "Keep using HotelAI after the 7-day trial with a monthly or annual plan." },
];

const industries = [
  { name: "Hotels & guesthouses", note: "Available first" },
  { name: "Restaurants", note: "Planned" },
  { name: "Beauty salons", note: "Planned" },
  { name: "Clinics (administrative only)", note: "Planned" },
  { name: "Real estate agencies", note: "Planned" },
];

const faqs = [
  {
    q: "Do I need a payment card for the trial?",
    a: "No. The 7-day trial starts when you create your business workspace and needs no card. You choose a plan only if you want to continue.",
  },
  {
    q: "Can the AI make up prices or availability?",
    a: "The agents are designed to answer from your configured information and to check availability through our booking engine. A reservation is only reported as confirmed after it has been saved in the database.",
  },
  {
    q: "Is my business data kept separate from other businesses?",
    a: "Yes. Each business has a private workspace, and isolation is enforced in the database itself with row-level security, not just in the user interface.",
  },
  {
    q: "What happens when my trial ends?",
    a: "Your agents pause, but you can still sign in, see your data and upgrade. We do not delete your data because a trial ended.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col bg-surface">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-gradient-to-b from-brand-50 to-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
            <p className="mx-auto inline-flex rounded-full border border-brand-200 bg-surface px-3 py-1 text-xs font-medium text-brand-700">
              AI automation for hospitality
            </p>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
              AI agents that answer your guests and book against your real availability
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
              HotelAI gives hotels and guesthouses an AI receptionist and reservation assistant that work from
              your own rooms, prices and policies — inside a private, secure workspace for your business.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/auth/sign-up" size="lg">
                Start your 7-day free trial
              </ButtonLink>
              <ButtonLink href="/pricing" variant="secondary" size="lg">
                See pricing
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-subtle">No payment card required.</p>
          </div>
        </section>

        {/* Agents */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Your AI team</h2>
          <p className="mt-3 max-w-2xl text-muted">
            One shared platform, configured for your business. Every agent uses the same secure runtime, usage
            limits and permission checks.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {agents.map((agent) => (
              <Card key={agent.name} className="p-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{agent.name}</h3>
                  <span
                    className={
                      agent.status === "Core"
                        ? "rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700"
                        : "rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted"
                    }
                  >
                    {agent.status}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted">{agent.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-y border-border bg-canvas">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-10 grid gap-6 md:grid-cols-4">
              {steps.map((step, i) => (
                <li key={step.title}>
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Industries */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Built for hotels first</h2>
          <p className="mt-3 max-w-2xl text-muted">
            HotelAI launches for hotels and guesthouses. Configurable industry templates for other service
            businesses follow on the same platform.
          </p>
          <ul className="mt-8 flex flex-wrap gap-3">
            {industries.map((industry) => (
              <li key={industry.name} className="rounded-full border border-border px-4 py-2 text-sm">
                <span className="font-medium">{industry.name}</span>
                <span className="ml-2 text-subtle">{industry.note}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* FAQ */}
        <section className="border-t border-border bg-canvas">
          <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">Frequently asked questions</h2>
            <dl className="mt-8 space-y-6">
              {faqs.map((faq) => (
                <div key={faq.q}>
                  <dt className="font-semibold">{faq.q}</dt>
                  <dd className="mt-2 text-sm leading-6 text-muted">{faq.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Ready to try it with your own hotel?</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Create your account, set up your workspace and test your agents for seven days.
          </p>
          <ButtonLink href="/auth/sign-up" size="lg" className="mt-8">
            Start free trial
          </ButtonLink>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

