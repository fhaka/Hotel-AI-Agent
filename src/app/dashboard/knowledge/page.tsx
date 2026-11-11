import type { Metadata } from "next";
import Link from "next/link";
import { deleteKnowledgeEntry } from "@/app/dashboard/knowledge/actions";
import { DeleteEntryForm } from "@/components/knowledge/delete-entry";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { KNOWLEDGE_CATEGORIES, categoryInfo, isKnowledgeCategory } from "@/lib/knowledge/categories";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Knowledge base" };

const PAGE_SIZE = 20;

const NOTICES: Record<string, string> = {
  created: "Entry added. Your agents will use it from their next conversation.",
  updated: "Entry updated.",
  deleted: "Entry deleted.",
};

export default async function KnowledgePage({ searchParams }: PageProps<"/dashboard/knowledge">) {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/knowledge");
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(params.q).slice(0, 200);
  const rawCategory = one(params.category);
  const category = isKnowledgeCategory(rawCategory) ? rawCategory : null;
  const page = Math.max(1, Math.min(1000, Number.parseInt(one(params.page) || "1", 10) || 1));
  const notice = NOTICES[one(params.notice)];
  const canEdit = ent.can("knowledge.edit");

  const supabase = await createClient();
  const [{ data: rows, error }, { data: allCategories }] = await Promise.all([
    supabase.rpc("search_agent_knowledge", {
      p_business_id: workspace.businessId,
      p_query: q || undefined,
      p_category: category ?? undefined,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    supabase.from("agent_knowledge").select("category").eq("business_id", workspace.businessId).limit(1000),
  ]);
  if (error) {
    console.error("[knowledge] search failed", { code: error.code });
    throw new Error("Could not load the knowledge base.");
  }

  const entries = rows ?? [];
  const total = entries.length ? Number(entries[0].total_count) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts = new Map<string, number>();
  for (const r of allCategories ?? []) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const totalEntries = allCategories?.length ?? 0;

  const href = (overrides: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    const merged = { q: q || null, category, page: null, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return `/dashboard/knowledge${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge base</h1>
          <p className="mt-1 text-sm text-muted">
            What your AI agents know about {workspace.name}. They answer only from this and your business settings.
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/dashboard/knowledge/preview" variant="secondary">
            Preview agent knowledge
          </ButtonLink>
          {canEdit ? <ButtonLink href={`/dashboard/knowledge/new${category ? `?category=${category}` : ""}`}>Add entry</ButtonLink> : null}
        </div>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!canEdit ? <Alert tone="info">You can read the knowledge base. Owners, admins and managers can edit it.</Alert> : null}

      <Card className="p-4 text-sm text-muted">
        Hours, policies, check-in times and rooms are managed in{" "}
        <Link href="/dashboard/business" className="font-medium text-brand-600 hover:text-brand-700">
          Business settings
        </Link>{" "}
        and are included automatically. Use the knowledge base for everything else.
      </Card>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Categories" className="flex flex-wrap gap-2">
          <CategoryChip href={href({ category: null })} active={!category} label={`All (${totalEntries})`} />
          {KNOWLEDGE_CATEGORIES.filter((c) => counts.get(c.value)).map((c) => (
            <CategoryChip key={c.value} href={href({ category: c.value })} active={category === c.value} label={`${c.label} (${counts.get(c.value)})`} />
          ))}
        </nav>
        <form action="/dashboard/knowledge" method="get" role="search" className="flex gap-2">
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <label htmlFor="kb-search" className="sr-only">
            Search knowledge
          </label>
          <input
            id="kb-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={200}
            placeholder="Search…"
            className="h-9 w-56 rounded-lg border border-border bg-surface px-3 text-sm"
          />
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {entries.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-medium">{q || category ? "No entries match your filters." : "Your knowledge base is empty."}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            {q || category
              ? "Try a different search or category."
              : "Add the questions customers ask most, your services and any prices you want agents to quote."}
          </p>
          {canEdit && !q && !category ? (
            <ButtonLink href="/dashboard/knowledge/new?category=faq" className="mt-6">
              Add your first FAQ
            </ButtonLink>
          ) : null}
        </Card>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="brand">{categoryInfo(e.category).label}</Badge>
                      {e.source_type === "onboarding" ? <Badge>From setup</Badge> : null}
                    </div>
                    <h2 className="mt-2 font-medium">{e.title}</h2>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted">{e.content}</p>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <ButtonLink href={`/dashboard/knowledge/${e.id}`} variant="secondary" size="sm">
                        Edit
                      </ButtonLink>
                      <DeleteEntryForm entryId={e.id} title={e.title} action={deleteKnowledgeEntry} />
                    </div>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="text-brand-600">← Previous</Link> : <span />}
          <span className="text-muted">
            Page {page} of {pages} · {total} entries
          </span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className="text-brand-600">Next →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}

function CategoryChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-sm",
        active ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-border text-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}
