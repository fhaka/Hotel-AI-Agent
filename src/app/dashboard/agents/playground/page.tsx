import type { Metadata } from "next";
import Link from "next/link";
import { ChatPanel, type ChatItem } from "@/components/playground/chat-panel";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { DEFAULT_CONTEXT_BUDGET, formatKnowledgeContext } from "@/lib/knowledge/context";
import { loadKnowledgeSources } from "@/lib/knowledge/load";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Agent playground" };

const CHAT_AGENT_TYPES = ["website_receptionist", "reservation_assistant"] as const;

function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL && process.env.SUPABASE_SECRET_KEY);
}

export default async function PlaygroundPage({ searchParams }: PageProps<"/dashboard/agents/playground">) {
  const { user, workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/agents/playground");
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const supabase = await createClient();

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, agent_type, enabled, status")
    .eq("business_id", workspace.businessId)
    .in("agent_type", [...CHAT_AGENT_TYPES])
    .not("status", "in", "(not_configured,disabled)")
    .order("agent_type");
  const available = agents ?? [];
  const agent = available.find((a) => a.id === one(params.agent)) ?? available.find((a) => a.enabled) ?? available[0];

  if (!agent) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Agent playground</h1>
        <Alert tone="info">No chat agents are available for this workspace.</Alert>
      </div>
    );
  }

  const requestedConversation = one(params.conversation);
  const [conversations, sources] = await Promise.all([
    supabase
      .from("agent_conversations")
      .select("id, status, updated_at, created_at")
      .eq("business_id", workspace.businessId)
      .eq("agent_id", agent.id)
      .eq("channel", "playground")
      .eq("started_by", user.id)
      .order("updated_at", { ascending: false })
      .limit(10),
    loadKnowledgeSources(supabase, workspace.businessId),
  ]);
  const myConversations = conversations.data ?? [];
  const current = isUuid(requestedConversation) ? myConversations.find((c) => c.id === requestedConversation) ?? null : null;

  let items: ChatItem[] = [];
  if (current) {
    const { data: messages } = await supabase
      .from("agent_messages")
      .select("id, sender_type, content, tool_name, metadata")
      .eq("business_id", workspace.businessId)
      .eq("conversation_id", current.id)
      .order("id")
      .limit(200);
    items = (messages ?? []).map((m): ChatItem => {
      const id = String(m.id);
      if (m.sender_type === "customer") return { kind: "customer", id, text: m.content };
      if (m.sender_type === "agent") return { kind: "agent", id, text: m.content };
      if (m.sender_type === "tool") return { kind: "tool", id, text: m.content, ok: Boolean((m.metadata as { ok?: boolean })?.ok) };
      return { kind: "system", id, text: m.content };
    });
  }

  const decision = ent.agent(agent.agent_type);
  const disabledReason = !aiConfigured()
    ? "AI is not configured on this server yet. An administrator needs to set OPENAI_API_KEY, OPENAI_MODEL and SUPABASE_SECRET_KEY."
    : !decision.allowed
      ? decision.message
      : null;
  const knowledge = sources ? formatKnowledgeContext(sources) : null;
  const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent playground</h1>
          <p className="mt-1 text-sm text-muted">
            Test your agents privately before customers see them. This is not a live customer channel.
          </p>
        </div>
        <nav aria-label="Agents" className="flex gap-2">
          {available.map((a) => (
            <Link
              key={a.id}
              href={`/dashboard/agents/playground?agent=${a.id}`}
              aria-current={a.id === agent.id ? "page" : undefined}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm",
                a.id === agent.id ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-border text-muted hover:text-ink",
              )}
            >
              {a.name}
              {!a.enabled ? " (off)" : ""}
            </Link>
          ))}
        </nav>
      </div>

      {agent.agent_type === "reservation_assistant" ? (
        <Alert tone="info">
          Booking tools are not connected yet, so this agent cannot check availability or create reservations. It is
          instructed never to claim otherwise and to hand booking requests to your team.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <ChatPanel
          key={`${agent.id}:${current?.id ?? "new"}`}
          agentId={agent.id}
          agentName={agent.name}
          initialConversationId={current?.id ?? null}
          initialItems={items}
          initiallyEscalated={current?.status === "escalated"}
          disabledReason={disabledReason}
          usage={{ used: ent.usage.aiMessages.used, limit: ent.usage.aiMessages.limit }}
        />

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Knowledge in use</h2>
            {knowledge ? (
              <p className="mt-2 text-sm text-muted">
                {knowledge.includedEntryIds.length} knowledge entries plus your business settings ·{" "}
                {Math.round((knowledge.charCount / DEFAULT_CONTEXT_BUDGET) * 100)}% of the context budget
                {knowledge.truncated ? ` · ${knowledge.omittedEntryIds.length} entries don't fit` : ""}.
              </p>
            ) : null}
            <div className="mt-3 flex flex-col gap-1 text-sm">
              <Link href="/dashboard/knowledge/preview" className="text-brand-600 hover:text-brand-700">
                See exactly what the agent knows →
              </Link>
              <Link href="/dashboard/knowledge" className="text-brand-600 hover:text-brand-700">
                Edit knowledge base →
              </Link>
              {ent.can("agents.configure") ? (
                <Link href={`/dashboard/agents/${agent.id}`} className="text-brand-600 hover:text-brand-700">
                  Agent settings →
                </Link>
              ) : null}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Your test conversations</h2>
              <ButtonLink href={`/dashboard/agents/playground?agent=${agent.id}`} variant="ghost" size="sm">
                New
              </ButtonLink>
            </div>
            {myConversations.length === 0 ? (
              <p className="mt-2 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {myConversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/dashboard/agents/playground?agent=${agent.id}&conversation=${c.id}`}
                      className={cn(
                        "block rounded-lg px-2 py-1.5 text-sm",
                        c.id === current?.id ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-canvas hover:text-ink",
                      )}
                    >
                      {dateFmt.format(new Date(c.created_at))} UTC{c.status === "escalated" ? " · handed over" : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-subtle">Test conversations are deleted automatically after 90 days.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
