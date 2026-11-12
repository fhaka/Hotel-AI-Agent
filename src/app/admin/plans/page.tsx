import type { Metadata } from "next";
import { updatePlan } from "@/app/admin/actions";
import { AdminForm } from "@/components/admin/admin-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { fmtMoney } from "@/lib/admin/format";
import { FEATURES, LIMIT_KEYS, LIMIT_LABELS } from "@/lib/admin/schemas";

export const metadata: Metadata = { title: "Plans" };

export default async function AdminPlansPage() {
  const { supabase } = await requirePlatformAdmin("/admin/plans");
  const { data: plans, error } = await supabase.rpc("admin_list_plans");
  if (error) return <Alert tone="danger">Plans could not be loaded.</Alert>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-muted">
          Limits and features take effect immediately for every business on the plan. Prices are charged by Paddle: change them in
          Paddle (new price + price ID in the environment), not here.
        </p>
      </div>
      {(plans ?? []).map((p) => {
        const limits = (p.usage_limits ?? {}) as Record<string, number>;
        const features = (p.features ?? []) as string[];
        return (
          <Card key={p.id} className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <span className="font-mono text-xs text-muted">{p.id}</span>
              <Badge tone={p.is_active ? "success" : "neutral"}>{p.is_active ? "offered" : "hidden"}</Badge>
              <span className="text-sm text-muted">
                {fmtMoney(p.monthly_price_cents, p.currency)} / month · {fmtMoney(p.annual_price_cents, p.currency)} / year
              </span>
            </div>
            <AdminForm action={updatePlan.bind(null, p.id)} submitLabel="Save plan">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" name="name" defaultValue={p.name} required maxLength={80} />
                <Field label="Description" name="description" defaultValue={p.description ?? ""} maxLength={1000} />
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Limits per billing period (empty = unlimited)</legend>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {LIMIT_KEYS.map((k) => (
                    <Field key={k} label={LIMIT_LABELS[k]} name={`limit.${k}`} inputMode="numeric" pattern="\d*" defaultValue={limits[k]?.toString() ?? ""} />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Features</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  {FEATURES.map((f) => (
                    <label key={f} className="inline-flex items-center gap-2">
                      <input type="checkbox" name={`feature.${f}`} defaultChecked={features.includes(f)} />
                      {f.replaceAll("_", " ")}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="isActive" defaultChecked={p.is_active} /> Offered to new customers (pricing page and checkout)
              </label>
            </AdminForm>
          </Card>
        );
      })}
    </div>
  );
}
