import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { likeEscape } from "@/lib/reservations/queries";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Guests" };
const PAGE = 25;

export default async function GuestsPage({ searchParams }: PageProps<"/dashboard/guests">) {
  const { workspace } = await getWorkspaceContext("/dashboard/guests");
  if (workspace.industry !== "hotel") return <Alert tone="info">Guests are available for hotel workspaces.</Alert>;
  const p = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(p.q).trim().slice(0, 100);
  const page = Math.max(1, Math.min(500, Number.parseInt(one(p.page) || "1", 10) || 1));
  const supabase = await createClient();
  let query = supabase.from("guests").select("id, full_name, email, phone, preferred_language, created_at", { count: "exact" }).eq("business_id", workspace.businessId);
  if (q) {
    // Two separate parameterised filters (no PostgREST `or` string building).
    query = q.includes("@") ? query.ilike("email", `%${likeEscape(q.toLowerCase())}%`) : query.ilike("full_name", `%${likeEscape(q)}%`);
  }
  const { data, count, error } = await query.order("full_name").range((page - 1) * PAGE, page * PAGE - 1);
  if (error) throw new Error("Could not load guests.");
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (n: number) => `/dashboard/guests?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Guests</h1>
        <p className="mt-1 text-sm text-muted">Guests are created automatically with reservations (matched by email).</p>
      </div>
      <form method="get" action="/dashboard/guests" role="search" className="flex gap-2">
        <label htmlFor="guest-q" className="sr-only">Search guests</label>
        <input id="guest-q" name="q" defaultValue={q} maxLength={100} placeholder="Name or email" className="h-9 w-72 rounded-lg border border-border px-3 text-sm" />
        <Button type="submit" size="sm" variant="secondary">Search</Button>
      </form>
      {(data ?? []).length === 0 ? <Card className="p-10 text-center text-sm text-muted">No guests found.</Card> : (
        <Card>
          <ul className="divide-y divide-border">
            {(data ?? []).map((g) => (
              <li key={g.id}>
                <Link href={`/dashboard/guests/${g.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-canvas">
                  <span className="font-medium">{g.full_name}</span>
                  <span className="text-sm text-muted">{[g.email, g.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={link(page - 1)} className="text-brand-600">← Previous</Link> : <span />}
          <span className="text-muted">Page {page} of {pages} · {count} guests</span>
          {page < pages ? <Link href={link(page + 1)} className="text-brand-600">Next →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
