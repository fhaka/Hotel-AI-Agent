import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { getOnboardingContext, type OnboardingContext } from "@/lib/onboarding/queries";
import { getWorkspaceContext } from "@/lib/workspaces/context";

type Tab = "profile" | "operations" | "hotel";

const TABS: { key: Tab; label: string; href: string }[] = [
  { key: "profile", label: "Profile", href: "/dashboard/business" },
  { key: "operations", label: "Hours, policies & FAQs", href: "/dashboard/business/operations" },
  { key: "hotel", label: "Hotel & rooms", href: "/dashboard/business/hotel" },
];

/** Loads the active workspace's settings (owner/admin only) and renders the tab bar. */
export async function BusinessSettingsShell({
  tab,
  searchParams,
  children,
}: {
  tab: Tab;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  children: (ctx: OnboardingContext) => ReactNode | Promise<ReactNode>;
}) {
  const path = TABS.find((t) => t.key === tab)!.href;
  const { user, workspace } = await getWorkspaceContext(path);
  const [ctx, params] = await Promise.all([getOnboardingContext(user, workspace.businessId), searchParams]);
  const tabs = TABS.filter((t) => t.key !== "hotel" || workspace.industry === "hotel");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Business settings</h1>
        <p className="mt-1 text-sm text-muted">Everything here is what your AI agents know about {workspace.name}.</p>
      </div>
      <nav aria-label="Business settings" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              t.key === tab ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {params.saved === "1" ? <Alert tone="success">Changes saved.</Alert> : null}
      {ctx.access === "denied" ? (
        <Alert tone="info">Only owners and admins can change business settings. Your role is {ctx.role}.</Alert>
      ) : (
        <Card className="p-6 sm:p-8">{await children(ctx)}</Card>
      )}
    </div>
  );
}
