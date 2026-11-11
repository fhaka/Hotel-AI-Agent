import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { DEFAULT_CONTEXT_BUDGET, formatKnowledgeContext } from "@/lib/knowledge/context";
import { loadKnowledgeSources } from "@/lib/knowledge/load";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Agent knowledge preview" };

export default async function KnowledgePreviewPage() {
  const { workspace } = await getWorkspaceContext("/dashboard/knowledge/preview");
  const supabase = await createClient();
  const sources = await loadKnowledgeSources(supabase, workspace.businessId);
  const ctx = sources ? formatKnowledgeContext(sources) : null;
  const pct = ctx ? Math.round((ctx.charCount / DEFAULT_CONTEXT_BUDGET) * 100) : 0;

  return (
    <div className="space-y-6">
      <Link href="/dashboard/knowledge" className="text-sm text-muted hover:text-ink">
        ← Knowledge base
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">What your agents know</h1>
        <p className="mt-1 text-sm text-muted">
          This is exactly the business information your agents receive with each conversation. They are instructed to
          treat it as reference information and not to invent anything beyond it.
        </p>
      </div>
      {!ctx ? (
        <Alert tone="warning">Business information could not be loaded.</Alert>
      ) : (
        <>
          <p className="text-sm text-muted">
            Using {ctx.charCount.toLocaleString("en")} of {DEFAULT_CONTEXT_BUDGET.toLocaleString("en")} characters ({pct}%) ·{" "}
            {ctx.includedEntryIds.length} knowledge entries included.
          </p>
          {ctx.truncated ? (
            <Alert tone="warning" title={`${ctx.omittedEntryIds.length} entries don't fit`}>
              The knowledge is larger than what agents can receive at once, so lower-priority entries (in the order FAQ →
              policies → prices → services → hours → hotel → about → other) were left out. Shorten or merge entries.
            </Alert>
          ) : null}
          <Card className="p-0">
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-6 font-mono text-xs leading-relaxed text-ink">
              {ctx.text}
            </pre>
          </Card>
        </>
      )}
    </div>
  );
}
