import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AGENT_STATUS_LABEL, AGENT_TYPE_INFO } from "@/lib/agents/config";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "AI agents" };

export default async function AgentsPage() {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/agents");
  const supabase = await createClient();
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, agent_type, enabled, status")
    .eq("business_id", workspace.businessId)
    .order("agent_type");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI agents</h1>
        <p className="mt-1 text-sm text-muted">Configure how each agent behaves, then test it in the playground.</p>
      </div>
      <div>
        <ButtonLink href="/dashboard/agents/playground">Open playground</ButtonLink>
      </div>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(agents ?? []).map((a) => {
          const decision = ent.agent(a.agent_type);
          return (
            <li key={a.id}>
              <Card className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{a.name}</h2>
                  <Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "On" : "Off"}</Badge>
                </div>
                <p className="mt-2 flex-1 text-sm text-muted">{AGENT_TYPE_INFO[a.agent_type]?.summary}</p>
                <p className="mt-3 text-xs text-subtle">{AGENT_STATUS_LABEL[a.status]}</p>
                {!decision.allowed && a.enabled ? <p className="mt-2 text-xs text-warning-700">{decision.message}</p> : null}
                {a.status !== "not_configured" && a.status !== "disabled" ? (
                  <Link href={`/dashboard/agents/${a.id}`} className="mt-4 text-sm font-medium text-brand-600 hover:text-brand-700">
                    {ent.can("agents.configure") ? "Configure →" : "View settings →"}
                  </Link>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
