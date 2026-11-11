import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateKnowledgeEntry } from "@/app/dashboard/knowledge/actions";
import { KnowledgeForm } from "@/components/knowledge/knowledge-form";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Edit knowledge" };

export default async function EditKnowledgePage({ params }: PageProps<"/dashboard/knowledge/[entryId]">) {
  const { entryId } = await params;
  const { workspace, entitlements: ent } = await getWorkspaceContext(`/dashboard/knowledge/${entryId}`);
  if (!isUuid(entryId)) notFound();
  const supabase = await createClient();
  const { data: entry } = await supabase
    .from("agent_knowledge")
    .select("id, title, content, category, source_type")
    .eq("id", entryId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  if (!entry) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/dashboard/knowledge" className="text-sm text-muted hover:text-ink">
        ← Knowledge base
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Edit knowledge</h1>
      {entry.source_type === "onboarding" ? (
        <Alert tone="info">This entry was created during setup. It also appears in Business settings → Hours, policies & FAQs.</Alert>
      ) : null}
      {ent.can("knowledge.edit") ? (
        <Card className="p-6 sm:p-8">
          <KnowledgeForm
            action={updateKnowledgeEntry.bind(null, entry.id)}
            defaults={{ category: entry.category, title: entry.title, content: entry.content }}
            submitLabel="Save changes"
          />
        </Card>
      ) : (
        <Alert tone="info">Only owners, admins and managers can edit the knowledge base.</Alert>
      )}
    </div>
  );
}
