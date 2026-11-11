import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveConversation } from "@/app/dashboard/conversations/actions";
import { ResolveButton } from "@/components/automation/resolve-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatInZone } from "@/lib/billing/trial";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: PageProps<"/dashboard/conversations/[conversationId]">) {
  const { conversationId } = await params;
  const { workspace } = await getWorkspaceContext(`/dashboard/conversations/${conversationId}`);
  if (!isUuid(conversationId)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("agent_conversations")
    .select("id, channel, status, created_at, escalated_at, escalation, agents ( name )")
    .eq("id", conversationId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  if (!c) notFound();
  const [{ data: messages }, { data: biz }] = await Promise.all([
    supabase.from("agent_messages").select("id, sender_type, content, tool_name, created_at").eq("conversation_id", c.id).order("id").limit(300),
    supabase.from("businesses").select("timezone").eq("id", workspace.businessId).single(),
  ]);
  const tz = biz?.timezone ?? "UTC";
  const e = (c.escalation ?? {}) as Record<string, string | null>;

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/dashboard/conversations" className="text-sm text-muted hover:text-ink">← Conversations</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{(c.agents as unknown as { name: string } | null)?.name} · {c.channel}</h1>
        <Badge tone={c.status === "escalated" ? "warning" : "neutral"}>{c.status === "escalated" ? "Needs a person" : c.status}</Badge>
      </div>
      {c.status === "escalated" ? (
        <Card className="space-y-3 border-warning-700/30 p-6">
          <h2 className="font-semibold">Handed over to your team{c.escalated_at ? ` · ${formatInZone(new Date(c.escalated_at), tz)}` : ""}</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {e.reason ? <div className="sm:col-span-2"><dt className="text-muted">Request</dt><dd>{e.reason}</dd></div> : null}
            {e.customer_name ? <div><dt className="text-muted">Name</dt><dd>{e.customer_name}</dd></div> : null}
            {e.customer_email ? <div><dt className="text-muted">Email</dt><dd><a href={`mailto:${e.customer_email}`} className="text-brand-600">{e.customer_email}</a></dd></div> : null}
            {e.customer_phone ? <div><dt className="text-muted">Phone</dt><dd>{e.customer_phone}</dd></div> : null}
          </dl>
          <ResolveButton action={resolveConversation.bind(null, c.id)} />
        </Card>
      ) : null}
      <Card className="space-y-3 p-6">
        {(messages ?? []).map((m) =>
          m.sender_type === "tool" || m.sender_type === "system" ? (
            <p key={m.id} className="text-center text-xs text-subtle">⚙ {m.content}</p>
          ) : (
            <div key={m.id} className={cn("flex", m.sender_type === "customer" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm", m.sender_type === "customer" ? "bg-brand-600 text-white" : "bg-canvas")}>
                {m.content}
                <span className={cn("mt-1 block text-[10px]", m.sender_type === "customer" ? "text-white/70" : "text-subtle")}>{formatInZone(new Date(m.created_at), tz)}</span>
              </div>
            </div>
          ),
        )}
      </Card>
    </div>
  );
}
