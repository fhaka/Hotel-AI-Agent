import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { fmtDate, statusTone } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Businesses" };

const PAGE_SIZE = 50;
const STATUSES = ["trialing", "trial_expired", "active", "past_due", "canceled", "paused", "suspended"] as const;

type Row = {
  id: string;
  name: string;
  industry: string;
  created_at: string;
  suspended_at: string | null;
  status: string | null;
  plan_id: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  owner_email: string | null;
};

export default async function AdminBusinessesPage({ searchParams }: PageProps<"/admin/businesses">) {
  const { supabase } = await requirePlatformAdmin("/admin/businesses");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : null;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1));
  const { data, error } = await supabase.rpc("admin_list_businesses", {
    p_search: q || undefined,
    p_status: status ?? undefined,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const result = (data ?? { total: 0, rows: [] }) as unknown as { total: number; rows: Row[] };
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const link = (p: number) => `/admin/businesses?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Businesses</h1>
      <form className="flex flex-wrap items-end gap-3" action="/admin/businesses">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Search</span>
          <input name="q" defaultValue={q} placeholder="Name, member email or id" className="h-10 w-72 rounded-lg border border-border px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Status</span>
          <select name="status" defaultValue={status ?? ""} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </label>
        <button className={buttonClasses("secondary")}>Filter</button>
      </form>

      {error ? <Alert tone="danger">The list could not be loaded.</Alert> : null}
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Trial / period ends</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {result.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <Link href={`/admin/businesses/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                  <span className="block text-xs text-subtle">{r.industry}</span>
                </td>
                <td className="px-4 py-3">{r.owner_email ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(r.status, Boolean(r.suspended_at))}>{r.suspended_at ? "suspended" : (r.status ?? "none")}</Badge>
                </td>
                <td className="px-4 py-3">{r.plan_id ?? "—"}</td>
                <td className="px-4 py-3">{fmtDate(r.status === "trialing" ? r.trial_ends_at : r.current_period_end)}</td>
                <td className="px-4 py-3">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">No businesses match.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{result.total} businesses · page {page} of {pages}</span>
        <span className="flex gap-2">
          {page > 1 ? <Link className={buttonClasses("secondary", "sm")} href={link(page - 1)}>Previous</Link> : null}
          {page < pages ? <Link className={buttonClasses("secondary", "sm")} href={link(page + 1)}>Next</Link> : null}
        </span>
      </div>
    </div>
  );
}
