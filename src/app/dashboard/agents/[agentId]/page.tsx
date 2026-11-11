import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateAgent } from "@/app/dashboard/agents/actions";
import { AgentForm } from "@/components/agents/agent-form";
import { Card } from "@/components/ui/card";
import { AGENT_TYPE_INFO, readAgentConfig } from "@/lib/agents/config";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Configure agent" };

export default async function AgentPage({ params }: PageProps<"/dashboard/agents/[agentId]">) {
  const { agentId } = await params;
  const { workspace, entitlements: ent } = await getWorkspaceContext(`/dashboard/agents/${agentId}`);
  if (!isUuid(agentId)) notFound();
  const supabase = await createClient();
  // Scoped to the active workspace AND protected by RLS.
  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, description, agent_type, enabled, status, system_configuration")
    .eq("id", agentId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  if (!agent || agent.status === "not_configured" || agent.status === "disabled") notFound();

  return (
    <div className="space-y-6">
      <Link href="/dashboard/agents" className="text-sm text-muted hover:text-ink">
        ← All agents
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
        <p className="mt-1 text-sm text-muted">{AGENT_TYPE_INFO[agent.agent_type]?.summary}</p>
      </div>
      <Card className="p-6 sm:p-8">
        <AgentForm
          action={updateAgent.bind(null, agent.id)}
          defaults={{
            name: agent.name,
            description: agent.description ?? "",
            enabled: agent.enabled,
            config: readAgentConfig(agent.system_configuration),
          }}
          canEnable
          readOnly={!ent.can("agents.configure")}
        />
      </Card>
    </div>
  );
}
