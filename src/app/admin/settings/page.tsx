import type { Metadata } from "next";
import { updateAgentAvailability, updateRetention, updateTrialSettings, updateWorkspaceLimit } from "@/app/admin/actions";
import { AdminForm } from "@/components/admin/admin-form";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { AGENT_TYPES, LIMIT_KEYS, LIMIT_LABELS } from "@/lib/admin/schemas";

export const metadata: Metadata = { title: "Platform settings" };

type Settings = {
  trial?: { days: number; max_trials_per_user: number; plan_id: string; usage_limits: Record<string, number> };
  workspaces?: { max_created_per_user: number };
  agent_availability?: Record<string, boolean>;
  agent_runtime?: { playground_retention_days: number; conversation_retention_days: number };
  retention?: Record<string, number>;
};

const RETENTION_FIELDS: [string, string, string][] = [
  ["conversation_retention_days", "Guest conversations (days)", "website, phone and WhatsApp transcripts"],
  ["playground_retention_days", "Playground tests (days)", "staff test chats"],
  ["notification_days", "Email log (days)", "sent/failed notifications"],
  ["job_run_days", "Job history (days)", "scheduler runs"],
  ["webhook_payload_days", "Billing webhook payloads (days)", "the event ids stay for duplicate protection"],
  ["audit_log_days", "Audit log (days)", "security-relevant actions"],
];

export default async function AdminSettingsPage() {
  const { supabase } = await requirePlatformAdmin("/admin/settings");
  const [{ data, error }, { data: plans }] = await Promise.all([supabase.rpc("admin_get_settings"), supabase.rpc("admin_list_plans")]);
  if (error || !data) return <Alert tone="danger">Settings could not be loaded.</Alert>;
  const s = data as unknown as Settings;
  const retention = { ...s.agent_runtime, ...s.retention } as Record<string, number | undefined>;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Platform settings</h1>
      <p className="text-sm text-muted">Every change is validated by the database and written to the audit log.</p>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Free trial</h2>
        <p className="text-sm text-muted">Applies to workspaces created from now on; running trials keep their end date.</p>
        <AdminForm action={updateTrialSettings} submitLabel="Save trial settings">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Trial length (days)" name="days" inputMode="numeric" defaultValue={s.trial?.days ?? 7} required />
            <Field label="Trials per person" name="max_trials_per_user" inputMode="numeric" defaultValue={s.trial?.max_trials_per_user ?? 1} required />
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Plan features during trial</span>
              <select name="plan_id" defaultValue={s.trial?.plan_id} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm">
                {(plans ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {LIMIT_KEYS.map((k) => (
              <Field key={k} label={LIMIT_LABELS[k]} name={`limit.${k}`} inputMode="numeric" pattern="\d*" defaultValue={s.trial?.usage_limits?.[k]?.toString() ?? ""} />
            ))}
          </div>
        </AdminForm>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Agent availability</h2>
        <p className="text-sm text-muted">
          Switch an agent type off for every business, e.g. during a provider outage. Its conversations stop immediately; customers see
          that the agent isn&apos;t included right now.
        </p>
        <AdminForm action={updateAgentAvailability} submitLabel="Save availability">
          <div className="flex flex-wrap gap-6 text-sm">
            {AGENT_TYPES.map((t) => (
              <label key={t} className="inline-flex items-center gap-2">
                <input type="checkbox" name={`agent.${t}`} defaultChecked={s.agent_availability?.[t] !== false} />
                {t.replaceAll("_", " ")}
              </label>
            ))}
          </div>
        </AdminForm>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Data retention</h2>
        <p className="text-sm text-muted">Older data is deleted by the scheduled job. Keep these in line with the privacy notice.</p>
        <AdminForm action={updateRetention} submitLabel="Save retention">
          <div className="grid gap-3 sm:grid-cols-2">
            {RETENTION_FIELDS.map(([name, label, hint]) => (
              <Field key={name} label={label} name={name} hint={hint} inputMode="numeric" defaultValue={retention[name] ?? ""} required />
            ))}
          </div>
        </AdminForm>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Workspaces</h2>
        <AdminForm action={updateWorkspaceLimit} submitLabel="Save">
          <Field label="Workspaces one person may create" name="max_created_per_user" inputMode="numeric" defaultValue={s.workspaces?.max_created_per_user ?? 10} required />
        </AdminForm>
      </Card>

      <Card className="space-y-2 p-6 text-sm">
        <h2 className="text-lg font-semibold">Platform administrators</h2>
        <p className="text-muted">
          Administrators can only be added in the Supabase SQL editor, so nobody can grant themselves access from the app:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-canvas p-3 text-xs">{`insert into public.platform_admins (user_id)
select id from auth.users where email = 'you@yourcompany.com';`}</pre>
      </Card>
    </div>
  );
}
