import type { Metadata } from "next";
import { Suspense } from "react";
import { WidgetChat } from "@/components/widget/widget-chat";
import { WIDGET_KEY } from "@/lib/channels/widget";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Chat", robots: { index: false } };

/** Embeddable chat (loaded in an iframe by /widget.js). */
export default function WidgetPage({ params }: PageProps<"/widget/[key]">) {
  return (
    <Suspense fallback={null}>
      <Widget params={params} />
    </Suspense>
  );
}

async function Widget({ params }: Pick<PageProps<"/widget/[key]">, "params">) {
  const { key } = await params;
  const supabase = await createClient();
  const { data } = WIDGET_KEY.test(key) ? await supabase.rpc("widget_public_config", { p_key: key }) : { data: null };
  const cfg = (data ?? { enabled: false }) as {
    enabled: boolean;
    business_name?: string;
    agent_name?: string;
    greeting?: string | null;
    accent_color?: string | null;
  };
  if (!cfg.enabled) {
    return <p className="p-6 text-center text-sm text-muted">This chat is not available right now.</p>;
  }
  const accent = /^#[0-9a-fA-F]{6}$/.test(cfg.accent_color ?? "") ? cfg.accent_color! : "#1f57d6";
  return <WidgetChat widgetKey={key} businessName={cfg.business_name ?? ""} agentName={cfg.agent_name ?? "Assistant"} greeting={cfg.greeting ?? null} accent={accent} />;
}
