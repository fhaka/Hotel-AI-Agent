"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type ChatItem =
  | { kind: "customer"; id: string; text: string; failed?: boolean }
  | { kind: "agent"; id: string; text: string }
  | { kind: "tool"; id: string; text: string; ok: boolean }
  | { kind: "system"; id: string; text: string };

type ApiSuccess = {
  conversationId: string;
  reply: string;
  escalated: boolean;
  toolEvents: { name: string; summary: string; ok: boolean }[];
  usage: { messagesUsed: number | null; messagesLimit: number | null };
};

const MAX = 2000;

export function ChatPanel({
  agentId,
  agentName,
  initialConversationId,
  initialItems,
  initiallyEscalated,
  disabledReason,
  usage: initialUsage,
}: {
  agentId: string;
  agentName: string;
  initialConversationId: string | null;
  initialItems: ChatItem[];
  initiallyEscalated: boolean;
  disabledReason: string | null;
  usage: { used: number; limit: number | null };
}) {
  const [items, setItems] = useState<ChatItem[]>(initialItems);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [escalated, setEscalated] = useState(initiallyEscalated);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState(initialUsage);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items, pending]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || pending || disabledReason) return;
    const localId = `local-${Date.now()}`;
    setItems((all) => [...all, { kind: "customer", id: localId, text }]);
    setInput("");
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, conversationId, message: text }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || "error" in body) {
        setItems((all) => all.map((i) => (i.id === localId ? { ...i, failed: true } : i)));
        setError(body?.error?.message ?? "The agent could not respond. Please try again.");
        if (body?.error?.code === "conversation_not_found") setConversationId(null);
        return;
      }
      const data = body as ApiSuccess;
      setConversationId(data.conversationId);
      setEscalated((e) => e || data.escalated);
      if (data.usage.messagesUsed !== null) setUsage({ used: data.usage.messagesUsed, limit: data.usage.messagesLimit });
      setItems((all) => [
        ...all,
        ...data.toolEvents.map((t, i): ChatItem => ({ kind: "tool", id: `${localId}-t${i}`, text: t.summary, ok: t.ok })),
        { kind: "agent", id: `${localId}-a`, text: data.reply },
      ]);
      const url = new URL(window.location.href);
      url.searchParams.set("conversation", data.conversationId);
      window.history.replaceState(null, "", url);
    } catch {
      setItems((all) => all.map((i) => (i.id === localId ? { ...i, failed: true } : i)));
      setError("Network error. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex h-[70vh] min-h-[28rem] flex-col rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{agentName}</span>
          <Badge tone="warning">Test mode</Badge>
          {escalated ? <Badge tone="brand">Handed over to staff</Badge> : null}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>
            {usage.used.toLocaleString("en")}
            {usage.limit !== null ? ` / ${usage.limit.toLocaleString("en")}` : ""} AI messages this period
          </span>
          <Link href={`/dashboard/agents/playground?agent=${agentId}`} className="font-medium text-brand-600 hover:text-brand-700">
            New conversation
          </Link>
        </div>
      </div>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {items.length === 0 ? (
          <p className="mx-auto mt-10 max-w-sm text-center text-sm text-muted">
            Send a message as if you were a customer. Messages here are stored as test conversations and count towards your
            AI usage.
          </p>
        ) : null}
        {items.map((item) => (
          <Message key={item.id} item={item} />
        ))}
        {pending ? (
          <div className="flex items-center gap-2 text-sm text-muted" role="status">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />
            {agentName} is typing…
          </div>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        {error ? (
          <div className="mb-2">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
        {disabledReason ? (
          <Alert tone="warning">{disabledReason}</Alert>
        ) : (
          <form onSubmit={send} className="flex items-end gap-2">
            <label htmlFor="playground-input" className="sr-only">
              Message
            </label>
            <textarea
              id="playground-input"
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX))}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={MAX}
              placeholder="Ask what a guest would ask… (Enter to send, Shift+Enter for a new line)"
              className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              disabled={pending}
            />
            <Button type="submit" disabled={pending || !input.trim()}>
              Send
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function Message({ item }: { item: ChatItem }) {
  if (item.kind === "tool") {
    return (
      <p className={cn("text-center text-xs", item.ok ? "text-subtle" : "text-warning-700")}>
        ⚙ {item.text}
      </p>
    );
  }
  if (item.kind === "system") return <p className="text-center text-xs text-warning-700">{item.text}</p>;
  const mine = item.kind === "customer";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm",
          mine ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm bg-canvas text-ink",
          mine && item.failed ? "opacity-60" : null,
        )}
      >
        {item.text}
        {mine && item.failed ? <span className="mt-1 block text-xs">Not answered</span> : null}
      </div>
    </div>
  );
}
