"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/** Only pages that exist are listed; new sections are added as they ship. */
const NAV = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/agents", label: "AI agents" },
  { href: "/dashboard/business", label: "Business" },
  { href: "/dashboard/team", label: "Team" },
  { href: "/dashboard/billing", label: "Plan & usage" },
  { href: "/dashboard/settings", label: "Account" },
];

export function SidebarNav() {
  return <SidebarNavList pathname={usePathname()} />;
}

/** Same links without active state: prerendered fallback while the path streams in. */
export function SidebarNavList({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Workspace">
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {NAV.map((item) => {
          const active =
            pathname !== null &&
            (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium",
                  active ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-canvas hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
