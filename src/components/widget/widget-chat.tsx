"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Item = { role: "guest" | "agent" | "error"; text: string };

/**
 * The public chat inside the iframe. Talks only to /api/widget/chat on this
 * origin. Renders text only (React escapes everything; no HTML from the model).
 */
export function WidgetChat({
  widgetKey,
  businessName,
  agentName,
  greeting,
  accent,
}: {
  widgetKey: string;
  businessName: string;
  agentName: string;
  greeting: string | null;
  accent: string;
}) {
  const storageKey = `hotelai:${widgetKey}:token`;
  const [items, setItems] = useState<Item[]>([
    { role: "agent", text: greeting || `Hello! I'm ${agentName}, the virtual assistant of ${businessName}. How can I help you?` },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items, pending]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setItems((all) => [...all, { role: "guest", text }]);
    setPending(true);
    try {
      let token: string | null = null;
      try {
        token = window.localStorage.getItem(storageKey);
      } catch {
        token = null; // storage blocked (e.g. third-party restrictions): one-off conversation
      }
      const res = await fetch("/api/widget/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: widgetKey, token, message: text }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.reply) {
        setItems((all) => [...all, { role: "error", text: body?.error?.message ?? "Sorry, something went wrong. Please try again." }]);
        return;
      }
      try {
        window.localStorage.setItem(storageKey, body.token);
      } catch {
        /* ignore */
      }
      setItems((all) => [...all, { role: "agent", text: body.reply }]);
    } catch {
      setItems((all) => [...all, { role: "error", text: "Connection problem. Please try again." }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-surface text-sm">
      <header className="px-4 py-3 text-white" style={{ backgroundColor: accent }}>
        <p className="font-semibold">{businessName}</p>
        <p className="text-xs opacity-90">{agentName} · AI assistant</p>
      </header>
      <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {items.map((item, i) => (
          <div key={i} className={item.role === "guest" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                item.role === "guest"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm px-3 py-2 text-white"
                  : item.role === "error"
                    ? "max-w-[85%] rounded-2xl bg-danger-50 px-3 py-2 text-danger-700"
                    : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-canvas px-3 py-2"
              }
              style={item.role === "guest" ? { backgroundColor: accent } : undefined}
            >
              {item.text}
            </div>
          </div>
        ))}
        {pending ? <p className="text-xs text-muted" role="status">{agentName} is typing…</p> : null}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-border p-2">
        <label htmlFor="widget-input" className="sr-only">Your message</label>
        <input
          id="widget-input"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 2000))}
          maxLength={2000}
          placeholder="Type your question…"
          className="h-10 flex-1 rounded-lg border border-border px-3 focus:outline-none focus:ring-2 focus:ring-brand-100"
          disabled={pending}
        />
        <button type="submit" disabled={pending || !input.trim()} className="rounded-lg px-4 font-medium text-white disabled:opacity-50" style={{ backgroundColor: accent }}>
          Send
        </button>
      </form>
      <p className="px-3 pb-2 text-center text-[11px] text-subtle">
        You are chatting with an AI assistant. Please don&apos;t share card numbers or other sensitive data.
      </p>
    </div>
  );
}
