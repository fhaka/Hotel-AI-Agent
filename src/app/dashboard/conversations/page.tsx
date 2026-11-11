import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatInZone } from "@/lib/billing/trial";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Conversations" };
const FILTERS = [
  { key: "escalated", label: "Needs a person" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Handled / closed" },
  { key: "all", label: "All" },
] as const;

export default async function ConversationsPage({ searchParams }: PageProps<"/dashboard/conversations">) {
  const { workspace } = await getWorkspaceContext("/dashboard/conversations");
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.status)?.key ?? "escalated";
  const showTests = sp.tests === "1";
  const supabase = await createClient();
  let q = supabase
    .from("agent_conversations")
    .select("id, channel, status, created_at, updated_at, escalation, agents ( name )")
    .eq("business_id", workspace.businessId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (filter !== "all") q = q.eq("status", filter);
  if (!showTests) q = q.neq("channel", "playground");
  const [{ data }, { data: biz }] = await Promise.all([q, supabase.from("businesses").select("timezone").eq("id", workspace.businessId).single()]);
  const tz = biz?.timezone ?? "UTC";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
        <p className="mt-1 text-sm text-muted">What guests asked your AI agents, and which requests were handed over to your team.</p>
      </div>
      <nav aria-label="Filter" className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/dashboard/conversations?status=${f.key}${showTests ? "&tests=1" : ""}`} className={cn("rounded-full border px-3 py-1", f.key === filter ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-border text-muted hover:text-ink")}>
            {f.label}
          </Link>
        ))}
        <Link href={`/dashboard/conversations?status=${filter}${showTests ? "" : "&tests=1"}`} className="ml-2 text-muted underline">
          {showTests ? "Hide playground tests" : "Include playground tests"}
        </Link>
      </nav>
      {(data ?? []).length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">{filter === "escalated" ? "No requests are waiting for your team." : "No conversations."}</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {(data ?? []).map((c) => {
              const reason = (c.escalation as { reason?: string } | null)?.reason;
              return (
                <li key={c.id}>
                  <Link href={`/dashboard/conversations/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="font-medium">{(c.agents as unknown as { name: string } | null)?.name}</span>
                      <span className="text-sm text-muted"> · {c.channel}</span>
                      {reason ? <span className="block truncate text-sm text-muted">{reason}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted">{formatInZone(new Date(c.updated_at), tz)}</span>
                      <Badge tone={c.status === "escalated" ? "warning" : c.status === "open" ? "brand" : "neutral"}>{c.status === "escalated" ? "Needs a person" : c.status}</Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
