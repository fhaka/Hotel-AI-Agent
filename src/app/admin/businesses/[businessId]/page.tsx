import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { assignNumber, releaseNumber, setLimitOverrides, setSuspension } from "@/app/admin/actions";
import { AdminForm } from "@/components/admin/admin-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { fmtDate, fmtNumber, statusTone } from "@/lib/admin/format";
import { LIMIT_KEYS, LIMIT_LABELS } from "@/lib/admin/schemas";
import { isUuid } from "@/lib/workspaces/active";

export const metadata: Metadata = { title: "Business" };

type Detail = {
  business: {
    id: string;
    name: string;
    industry: string;
    country: string | null;
    timezone: string;
    created_at: string;
    suspended_at: string | null;
    suspension_reason: string | null;
    limit_overrides: Record<string, number>;
  };
  subscription: {
    status: string;
    plan_id: string;
    billing_interval: string | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    provider_subscription_id: string | null;
  } | null;
  entitlements: { access_active: boolean; reason: string | null; limits: Record<string, number>; usage: Record<string, number>; features: string[] };
  members: { email: string | null; role: string; status: string }[];
  agents: { agent_type: string; enabled: boolean; status: string }[];
  channels: { kind: string; enabled: boolean; address: string | null }[];
  counts: { rooms: number; reservations: number; conversations: number };
  subscription_events: { occurred_at: string; event_type: string; status: string | null; plan_id: string | null; outcome: string }[];
  audit: { created_at: string; action: string; entity_type: string | null; actor_email: string | null }[];
};

const USAGE_FOR: Record<string, string> = {
  ai_messages_per_month: "ai_messages",
  ai_tokens_per_month: "ai_tokens",
  voice_minutes_per_month: "voice_minutes",
  members: "members",
};

export default async function AdminBusinessPage({ params }: PageProps<"/admin/businesses/[businessId]">) {
  const { businessId } = await params;
  const { supabase } = await requirePlatformAdmin(`/admin/businesses/${businessId}`);
  if (!isUuid(businessId)) notFound();
  const { data, error } = await supabase.rpc("admin_business_detail", { p_business_id: businessId });
  if (error?.code === "P0002") notFound();
  if (error || !data) return <Alert tone="danger">This business could not be loaded.</Alert>;
  const d = data as unknown as Detail;
  const b = d.business;
  const suspended = Boolean(b.suspended_at);
  const ent = d.entitlements;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/businesses" className="text-sm text-muted hover:underline">← Businesses</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{b.name}</h1>
          <Badge tone={statusTone(d.subscription?.status, suspended)}>{suspended ? "suspended" : (d.subscription?.status ?? "no subscription")}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">
          {b.industry} · {b.country ?? "—"} · {b.timezone} · created {fmtDate(b.created_at)} · <span className="font-mono text-xs">{b.id}</span>
        </p>
      </div>

      {suspended ? (
        <Alert tone="danger" title={`Suspended since ${fmtDate(b.suspended_at, true)}`}>
          {b.suspension_reason}. AI agents, channels, bookings by AI and automations are blocked; the owner can still sign in and see their data.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-2 p-6 text-sm">
          <h2 className="text-base font-semibold">Subscription</h2>
          {d.subscription ? (
            <>
              <p>Plan: <strong>{d.subscription.plan_id}</strong> {d.subscription.billing_interval ? `(${d.subscription.billing_interval}ly)` : ""}</p>
              <p>Trial ends: {fmtDate(d.subscription.trial_ends_at, true)}</p>
              <p>Period ends: {fmtDate(d.subscription.current_period_end, true)}{d.subscription.cancel_at_period_end ? " (cancels)" : ""}</p>
              <p>Paddle subscription: <span className="font-mono text-xs">{d.subscription.provider_subscription_id ?? "—"}</span></p>
            </>
          ) : (
            <p className="text-muted">None.</p>
          )}
          <p>Access: {ent.access_active ? <Badge tone="success">active</Badge> : <Badge tone="danger">{ent.reason ?? "blocked"}</Badge>}</p>
        </Card>
        <Card className="space-y-2 p-6 text-sm">
          <h2 className="text-base font-semibold">Usage this period</h2>
          {Object.entries(USAGE_FOR).map(([limitKey, usageKey]) => (
            <p key={limitKey} className="flex justify-between">
              <span>{LIMIT_LABELS[limitKey as keyof typeof LIMIT_LABELS]}</span>
              <span className="tabular-nums">
                {fmtNumber(ent.usage?.[usageKey])} / {ent.limits?.[limitKey] !== undefined ? fmtNumber(ent.limits[limitKey]) : "∞"}
              </span>
            </p>
          ))}
          <p className="pt-2 text-muted">{d.counts.rooms} rooms · {d.counts.reservations} reservations · {d.counts.conversations} conversations</p>
        </Card>
        <Card className="space-y-2 p-6 text-sm">
          <h2 className="text-base font-semibold">Team</h2>
          <ul className="space-y-1">
            {d.members.map((m, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{m.email ?? "—"}</span>
                <span className="text-muted">{m.role}{m.status !== "active" ? ` (${m.status})` : ""}</span>
              </li>
            ))}
          </ul>
          <h2 className="pt-3 text-base font-semibold">Agents</h2>
          <ul className="space-y-1">
            {d.agents.map((a) => (
              <li key={a.agent_type} className="flex justify-between"><span>{a.agent_type.replaceAll("_", " ")}</span><span className="text-muted">{a.enabled ? "on" : "off"} · {a.status}</span></li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{suspended ? "Lift suspension" : "Suspend business"}</h2>
          <p className="text-sm text-muted">
            For abuse, fraud or legal requests. Suspension blocks AI agents, public channels and automations immediately. It does not cancel billing in Paddle.
          </p>
          <AdminForm action={setSuspension.bind(null, b.id)} submitLabel={suspended ? "Lift suspension" : "Suspend"} variant={suspended ? "secondary" : "danger"}>
            <input type="hidden" name="suspended" value={suspended ? "false" : "true"} />
            {suspended ? null : <Field label="Reason (internal)" name="reason" required minLength={3} maxLength={500} />}
          </AdminForm>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">Limit overrides</h2>
          <p className="text-sm text-muted">Replace this business&apos;s plan or trial limits. Leave a field empty to use the plan&apos;s value.</p>
          <AdminForm action={setLimitOverrides.bind(null, b.id)} submitLabel="Save overrides">
            <div className="grid gap-3 sm:grid-cols-2">
              {LIMIT_KEYS.map((k) => (
                <Field key={k} label={LIMIT_LABELS[k]} name={`limit.${k}`} inputMode="numeric" pattern="\d*" defaultValue={b.limit_overrides?.[k]?.toString() ?? ""} />
              ))}
            </div>
          </AdminForm>
        </Card>
      </div>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Phone numbers</h2>
        <p className="text-sm text-muted">
          Buy the number in Twilio and point its webhooks to this app first (docs/setup/channels.md). A number can belong to one business only.
        </p>
        <ul className="space-y-2 text-sm">
          {d.channels.filter((c) => c.kind !== "website_widget").map((c) => (
            <li key={c.kind} className="flex flex-wrap items-center gap-3">
              <span className="w-24 font-medium">{c.kind === "voice" ? "Phone" : "WhatsApp"}</span>
              <span className="font-mono">{c.address ?? "none"}</span>
              <Badge tone={c.enabled ? "success" : "neutral"}>{c.enabled ? "enabled by owner" : "off"}</Badge>
              {c.address ? (
                <AdminForm action={releaseNumber.bind(null, b.id, c.kind as "voice" | "whatsapp")} submitLabel="Release" variant="secondary" className="inline-flex items-center gap-2" />
              ) : null}
            </li>
          ))}
          <li className="text-muted">Website chat: {d.channels.find((c) => c.kind === "website_widget")?.enabled ? "live" : "off"}</li>
        </ul>
        <AdminForm action={assignNumber.bind(null, b.id)} submitLabel="Assign number" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Channel</span>
            <select name="kind" className="h-10 rounded-lg border border-border bg-surface px-3 text-sm">
              <option value="voice">Phone (voice)</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
          <Field label="Number (E.164)" name="address" placeholder="+355691234567" required />
        </AdminForm>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-semibold">Billing events</h2>
          {d.subscription_events.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="divide-y divide-border text-sm">
              {d.subscription_events.map((e, i) => (
                <li key={i} className="py-2">{e.event_type} → {e.status ?? "—"} {e.plan_id ? `(${e.plan_id})` : ""} · {e.outcome}<span className="block text-xs text-subtle">{fmtDate(e.occurred_at, true)}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-semibold">Audit log</h2>
          {d.audit.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="divide-y divide-border text-sm">
              {d.audit.map((a, i) => (
                <li key={i} className="py-2"><span className="font-mono text-xs">{a.action}</span><span className="block text-xs text-subtle">{fmtDate(a.created_at, true)} · {a.actor_email ?? "system"}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
