"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/** Only pages that exist are listed; new sections are added as they ship. */
type Item = { href: string; label: string; exact?: boolean; hotelOnly?: boolean };
const NAV: Item[] = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/reservations", label: "Reservations", hotelOnly: true },
  { href: "/dashboard/calendar", label: "Calendar", hotelOnly: true },
  { href: "/dashboard/rooms", label: "Rooms", hotelOnly: true },
  { href: "/dashboard/guests", label: "Guests", hotelOnly: true },
  { href: "/dashboard/conversations", label: "Conversations" },
  { href: "/dashboard/agents", label: "AI agents" },
  { href: "/dashboard/knowledge", label: "Knowledge base" },
  { href: "/dashboard/automations", label: "Automations" },
  { href: "/dashboard/business", label: "Business" },
  { href: "/dashboard/team", label: "Team" },
  { href: "/dashboard/billing", label: "Plan & usage" },
  { href: "/dashboard/settings", label: "Account" },
];

export function SidebarNav({ isHotel }: { isHotel: boolean }) {
  return <SidebarNavList pathname={usePathname()} isHotel={isHotel} />;
}

/** Same links without active state: prerendered fallback while the path streams in. */
export function SidebarNavList({ pathname, isHotel = false }: { pathname: string | null; isHotel?: boolean }) {
  return (
    <nav aria-label="Workspace">
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {NAV.filter((item) => isHotel || !item.hotelOnly).map((item) => {
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
