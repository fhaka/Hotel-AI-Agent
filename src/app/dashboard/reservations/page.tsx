import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/knowledge/context";
import { formatStayDate, isValidDate } from "@/lib/reservations/dates";
import { RESERVATION_LIST_SELECT, likeEscape, type ReservationListRow } from "@/lib/reservations/queries";
import { STATUS_INFO, isAiSource, type ReservationStatus } from "@/lib/reservations/status";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Reservations" };

const PAGE = 25;
const STATUSES = Object.keys(STATUS_INFO) as ReservationStatus[];

export default async function ReservationsPage({ searchParams }: PageProps<"/dashboard/reservations">) {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/reservations");
  if (workspace.industry !== "hotel") {
    return <Alert tone="info">Reservations are available for hotel workspaces.</Alert>;
  }
  const p = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(p.q).trim().slice(0, 100);
  const status = STATUSES.includes(one(p.status) as ReservationStatus) ? (one(p.status) as ReservationStatus) : null;
  const from = isValidDate(one(p.from)) ? one(p.from) : null;
  const to = isValidDate(one(p.to)) ? one(p.to) : null;
  const aiOnly = one(p.source) === "ai";
  const page = Math.max(1, Math.min(500, Number.parseInt(one(p.page) || "1", 10) || 1));

  const supabase = await createClient();
  let query = supabase
    .from("reservations")
    .select(RESERVATION_LIST_SELECT, { count: "exact" })
    .eq("business_id", workspace.businessId);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("check_in", from);
  if (to) query = query.lte("check_in", to);
  if (aiOnly) query = query.in("source", ["ai_website", "ai_voice"]);
  if (q) {
    query = /^[0-9a-fA-F]{10}$/.test(q)
      ? query.eq("confirmation_reference", q.toUpperCase())
      : query.ilike("guests.full_name", `%${likeEscape(q)}%`);
  }
  const { data, count, error } = await query
    .order("check_in", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (error) {
    console.error("[reservations] list failed", { code: error.code });
    throw new Error("Could not load reservations.");
  }
  const rows = (data ?? []) as unknown as ReservationListRow[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const href = (o: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || null, status, from, to, source: aiOnly ? "ai" : null, page: null, ...o })) if (v) sp.set(k, v);
    return `/dashboard/reservations${sp.size ? `?${sp}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reservations</h1>
          <p className="mt-1 text-sm text-muted">{count ?? 0} reservation{count === 1 ? "" : "s"} match your filters.</p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/dashboard/calendar" variant="secondary">Calendar</ButtonLink>
          {ent.canCreateReservations ? <ButtonLink href="/dashboard/reservations/new">New reservation</ButtonLink> : null}
        </div>
      </div>

      <form method="get" action="/dashboard/reservations" className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_10rem_auto_auto] lg:items-end">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Guest name or confirmation no.</span>
          <input name="q" defaultValue={q} maxLength={100} className="h-9 w-full rounded-lg border border-border px-3" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Status</span>
          <select name="status" defaultValue={status ?? ""} className="h-9 w-full rounded-lg border border-border bg-surface px-2">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_INFO[s].label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Check-in from</span>
          <input type="date" name="from" defaultValue={from ?? ""} className="h-9 w-full rounded-lg border border-border px-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Check-in to</span>
          <input type="date" name="to" defaultValue={to ?? ""} className="h-9 w-full rounded-lg border border-border px-2" />
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="source" value="ai" defaultChecked={aiOnly} className="h-4 w-4 accent-brand-600" /> AI bookings only
        </label>
        <Button type="submit" variant="secondary" size="sm">Filter</Button>
      </form>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">No reservations found.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th className="px-4 py-3">Guest</th>
                <th className="px-4 py-3">Stay</th>
                <th className="px-4 py-3">Room</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/reservations/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {r.guests.full_name}
                    </Link>
                    <span className="block font-mono text-xs text-subtle">{r.confirmation_reference}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{formatStayDate(r.check_in)} → {formatStayDate(r.check_out)}</td>
                  <td className="px-4 py-3">{r.rooms?.room_types?.name} · {r.rooms?.room_number}</td>
                  <td className="px-4 py-3">{formatCurrency(r.total_price_cents, r.currency)}</td>
                  <td className="px-4 py-3"><Badge tone={STATUS_INFO[r.status].tone}>{STATUS_INFO[r.status].label}</Badge></td>
                  <td className="px-4 py-3">{isAiSource(r.source) ? <Badge tone="brand">AI</Badge> : <span className="text-muted">Staff</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="text-brand-600">← Previous</Link> : <span />}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className="text-brand-600">Next →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
