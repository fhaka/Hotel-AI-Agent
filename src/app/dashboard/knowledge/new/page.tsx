import type { Metadata } from "next";
import Link from "next/link";
import { createKnowledgeEntry } from "@/app/dashboard/knowledge/actions";
import { KnowledgeForm } from "@/components/knowledge/knowledge-form";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { isKnowledgeCategory } from "@/lib/knowledge/categories";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Add knowledge" };

export default async function NewKnowledgePage({ searchParams }: PageProps<"/dashboard/knowledge/new">) {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/knowledge/new");
  const { category } = await searchParams;
  const initial = typeof category === "string" && isKnowledgeCategory(category) ? category : "faq";

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/dashboard/knowledge" className="text-sm text-muted hover:text-ink">
        ← Knowledge base
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add knowledge</h1>
      {ent.can("knowledge.edit") ? (
        <Card className="p-6 sm:p-8">
          <KnowledgeForm
            action={createKnowledgeEntry.bind(null, workspace.businessId)}
            defaults={{ category: initial, title: "", content: "" }}
            submitLabel="Add entry"
          />
        </Card>
      ) : (
        <Alert tone="info">Only owners, admins and managers can edit the knowledge base.</Alert>
      )}
    </div>
  );
}
