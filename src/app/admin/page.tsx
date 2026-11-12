import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/admin/format";
import { assessLaunchReadiness, readinessSummary } from "@/lib/launch/readiness";

export const metadata: Metadata = { title: "Operator overview" };

type Overview = {
  generated_at: string;
  businesses: { total: number; suspended: number; created_7d: number; created_30d: number };
  users: number;
  subscriptions: Record<"trialing" | "trial_expired" | "active" | "past_due" | "canceling" | "ended", number>;
  mrr_estimate: Record<string, number>;
  usage_this_month: { ai_messages: number; ai_tokens: number; voice_minutes: number; emails: number; recorded_cost: Record<string, number> };
  health: {
    last_job_run: { finished_at: string; status: string; error: string | null } | null;
    failed_job_runs_24h: number;
    failed_notifications_7d: number;
    pending_notifications: number;
    failed_webhooks_7d: number;
  };
  recent_subscription_events: { occurred_at: string; event_type: string; status: string | null; plan_id: string | null; outcome: string; business_id: string; business_name: string | null }[];
  recent_activity: { created_at: string; action: string; entity_type: string | null; business_id: string | null; business_name: string | null; actor_email: string | null }[];
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </Card>
  );
}

export default async function AdminOverviewPage() {
  const { supabase } = await requirePlatformAdmin("/admin");
  const { data, error } = await supabase.rpc("admin_overview");
  if (error || !data) {
    return <Alert tone="danger">The overview could not be loaded. Check the server logs.</Alert>;
  }
  const o = data as unknown as Overview;
  const checks = assessLaunchReadiness(process.env);
  const readiness = readinessSummary(checks);
  const mrr = Object.entries(o.mrr_estimate);
  const cost = Object.entries(o.usage_this_month.recorded_cost);
  const lastRun = o.health.last_job_run;
  const scheduleStale = !lastRun || Date.parse(lastRun.finished_at) < Date.parse(o.generated_at) - 30 * 60_000;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform overview</h1>
        <p className="mt-1 text-sm text-muted">Generated {fmtDate(o.generated_at, true)}.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Businesses" value={fmtNumber(o.businesses.total)} hint={`+${o.businesses.created_7d} in 7 days · +${o.businesses.created_30d} in 30 days`} />
        <Stat label="Users" value={fmtNumber(o.users)} />
        <Stat label="Active subscriptions" value={fmtNumber(o.subscriptions.active)} hint={`${o.subscriptions.past_due} past due · ${o.subscriptions.canceling} canceling`} />
        <Stat label="Trials" value={fmtNumber(o.subscriptions.trialing)} hint={`${o.subscriptions.trial_expired} expired · ${o.subscriptions.ended} ended subscriptions`} />
        <Stat
          label="MRR (estimate)"
          value={mrr.length ? mrr.map(([cur, cents]) => fmtMoney(cents, cur)).join(" + ") : "—"}
          hint="List prices of provider-confirmed subscriptions; excludes tax, discounts, proration. Paddle is the source of truth."
        />
        <Stat label="AI messages this month" value={fmtNumber(o.usage_this_month.ai_messages)} hint={`${fmtNumber(o.usage_this_month.ai_tokens)} tokens`} />
        <Stat label="Voice minutes this month" value={fmtNumber(o.usage_this_month.voice_minutes)} hint={`${fmtNumber(o.usage_this_month.emails)} emails sent`} />
        <Stat
          label="AI cost this month"
          value={cost.length ? cost.map(([cur, v]) => `${fmtNumber(v)} ${cur}`).join(" + ") : "Not recorded"}
          hint="Only usage with a recorded provider cost. Check the OpenAI dashboard for exact spend."
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3 p-6">
          <h2 className="text-lg font-semibold">System health</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between gap-4">
              <span>Last scheduled run</span>
              <span>
                {lastRun ? fmtDate(lastRun.finished_at, true) : "never"}{" "}
                <Badge tone={scheduleStale ? "danger" : lastRun?.status === "ok" ? "success" : "warning"}>{scheduleStale ? "stale" : lastRun?.status}</Badge>
              </span>
            </li>
            <li className="flex justify-between"><span>Failed/partial job runs (24 h)</span><span className="tabular-nums">{o.health.failed_job_runs_24h}</span></li>
            <li className="flex justify-between"><span>Failed notifications (7 days)</span><span className="tabular-nums">{o.health.failed_notifications_7d}</span></li>
            <li className="flex justify-between"><span>Notifications waiting</span><span className="tabular-nums">{o.health.pending_notifications}</span></li>
            <li className="flex justify-between"><span>Failed billing webhooks (7 days)</span><span className="tabular-nums">{o.health.failed_webhooks_7d}</span></li>
          </ul>
          {lastRun?.error ? <p className="text-xs text-danger-700">Last error: {lastRun.error}</p> : null}
        </Card>

        <Card className="space-y-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Launch readiness</h2>
            <Badge tone={readiness.ready ? "success" : "danger"}>{readiness.ready ? "Ready" : `${readiness.blocking} missing`}</Badge>
          </div>
          <p className="text-xs text-muted">Configuration of this server. Values are never shown.</p>
          <ul className="space-y-1.5 text-sm">
            {checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span aria-hidden className={c.ok ? "text-success-700" : c.required ? "text-danger-700" : "text-warning-700"}>
                  {c.ok ? "✓" : c.required ? "✗" : "!"}
                </span>
                <span className={c.ok ? "text-muted" : ""}>{c.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-semibold">Subscription events</h2>
          {o.recent_subscription_events.length === 0 ? (
            <p className="text-sm text-muted">No billing events yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {o.recent_subscription_events.map((e, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                  <Link className="font-medium hover:underline" href={`/admin/businesses/${e.business_id}`}>{e.business_name ?? "Deleted business"}</Link>
                  <span className="text-muted">{e.event_type} → {e.status ?? "—"} {e.plan_id ? `(${e.plan_id})` : ""} · {e.outcome}</span>
                  <span className="w-full text-xs text-subtle">{fmtDate(e.occurred_at, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-semibold">Recent activity</h2>
          {o.recent_activity.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {o.recent_activity.map((a, i) => (
                <li key={i} className="py-2">
                  <span className="font-mono text-xs">{a.action}</span>{" "}
                  {a.business_id && a.business_name ? (
                    <Link className="hover:underline" href={`/admin/businesses/${a.business_id}`}>{a.business_name}</Link>
                  ) : null}
                  <span className="block text-xs text-subtle">
                    {fmtDate(a.created_at, true)} · {a.actor_email ?? "system"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
