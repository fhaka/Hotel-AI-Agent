import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { formatInZone, summarizeTrial } from "@/lib/billing/trial";
import { getBusinessEntitlements } from "@/lib/entitlements/service";
import { UsageMeter } from "@/components/ui/usage-meter";
import Link from "next/link";
import { INDUSTRIES } from "@/lib/onboarding/reference-data";
import { readCompletedSteps, resumeStep, stepPath } from "@/lib/onboarding/steps";
import { getActiveWorkspace } from "@/lib/workspaces/active";
import { getWorkspaceOverview } from "@/lib/workspaces/overview";

export const metadata: Metadata = { title: "Dashboard" };

const NOTICES: Record<string, string> = {
  "password-updated": "Your password has been updated.",
  "onboarding-complete": "Your workspace is set up. Next, test your agents in the playground.",
  "joined-workspace": "Welcome! You've joined the workspace.",
  "left-workspace": "You left the workspace.",
};

const AGENT_STATUS: Record<string, string> = {
  draft: "Configured, not yet tested",
  ready: "Ready",
  not_configured: "Not available yet",
  disabled: "Not used for this industry",
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  // Re-verify identity on the server; the proxy redirect is only a convenience.
  const user = await requireUser("/dashboard");
  const [{ active }, params] = await Promise.all([getActiveWorkspace(user), searchParams]);
  const notice = NOTICES[typeof params.notice === "string" ? params.notice : ""];

  if (!active) {
    return (
      <div className="space-y-6">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <Card className="p-10 text-center">
          <h1 className="text-lg font-semibold">Create your first business workspace</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Tell us about your business to set up your AI agents. Your 7-day free trial starts when the workspace is
            created — no payment card required.
          </p>
          <ButtonLink href="/onboarding" className="mt-6">
            Set up workspace
          </ButtonLink>
        </Card>
      </div>
    );
  }

  const [overview, ent] = await Promise.all([getWorkspaceOverview(active), getBusinessEntitlements(active.businessId, user)]);
  // Evaluated against the database clock, same as access decisions.
  const trial = summarizeTrial(overview.subscription, new Date(ent.snapshot.evaluated_at));
  const isAdmin = active.role === "owner" || active.role === "admin";
  const industry = INDUSTRIES.find((i) => i.value === active.industry)?.label ?? active.industry;
  const planName = overview.subscription?.plans?.name ?? overview.subscription?.plan_id ?? "—";

  return (
    <div className="space-y-6">
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{active.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {industry} · your role: <span className="capitalize">{active.role}</span>
          </p>
        </div>
        {isAdmin && active.onboardingCompleted ? (
          <ButtonLink href={stepPath(active.businessId, "company")} variant="secondary" size="sm">
            Edit business setup
          </ButtonLink>
        ) : null}
      </div>

      {!active.onboardingCompleted ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-brand-200 bg-brand-50 p-5">
          <div>
            <p className="font-medium text-brand-900">Finish setting up your workspace</p>
            <p className="text-sm text-brand-900/80">
              {isAdmin
                ? "Your agents answer from the information you add during setup."
                : "An owner or admin needs to finish the setup."}
            </p>
          </div>
          {isAdmin ? (
            <ButtonLink href={stepPath(active.businessId, resumeStep(active.industry, readCompletedSteps(active.onboardingState)))}>
              Continue setup
            </ButtonLink>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-sm font-medium text-muted">Subscription</h2>
          <p className="mt-2 text-lg font-semibold">{planName}</p>
          {trial.kind === "trialing" ? (
            <>
              <p className="mt-1 text-sm">
                <span className="rounded-full bg-success-50 px-2 py-0.5 font-medium text-success-700">Free trial</span>{" "}
                {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left
              </p>
              <p className="mt-2 text-xs text-muted">Ends {formatInZone(trial.endsAt, overview.timezone)}</p>
            </>
          ) : trial.kind === "trial_expired" ? (
            <p className="mt-1 text-sm text-warning-700">
              Your trial ended {formatInZone(trial.endedAt, overview.timezone)}. Agents are paused; your data is kept.
            </p>
          ) : trial.kind === "needs_plan" ? (
            <p className="mt-1 text-sm text-warning-700">
              No free trial is available for this workspace (one trial per account). A paid plan is required to use agents.
            </p>
          ) : (
            <p className="mt-1 text-sm capitalize">{trial.status.replace("_", " ")}</p>
          )}
          {ent.can("billing.view") ? (
            <Link href="/dashboard/billing" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
              Plan & usage →
            </Link>
          ) : null}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-medium text-muted">AI agents</h2>
          <ul className="mt-3 divide-y divide-border">
            {overview.agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">{a.name}</span>
                <span className={a.enabled ? "text-success-700" : "text-subtle"}>
                  {a.enabled ? AGENT_STATUS[a.status] ?? a.status : AGENT_STATUS[a.status] ?? "Off"}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/dashboard/agents/playground" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
            Test agents in the playground →
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {ent.can("usage.view") ? (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-medium text-muted">AI usage this period</h2>
            <UsageMeter label="Messages" used={ent.usage.aiMessages.used} limit={ent.usage.aiMessages.limit} />
          </Card>
        ) : null}
        <Card className="p-5">
          <h2 className="text-sm font-medium text-muted">Knowledge entries</h2>
          <p className="mt-2 text-2xl font-semibold">{overview.knowledgeCount}</p>
          <p className="mt-1 text-xs text-muted">Services and FAQs your agents can use.</p>
        </Card>
        {active.industry === "hotel" ? (
          <Card className="p-5">
            <h2 className="text-sm font-medium text-muted">Rooms</h2>
            <p className="mt-2 text-2xl font-semibold">{overview.roomCount}</p>
            <p className="mt-1 text-xs text-muted">Bookable rooms in your inventory.</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
