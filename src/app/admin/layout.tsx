import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/components/app/user-menu";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/settings", label: "Settings" },
];

/** Operator area. Each page checks platform-admin rights (404 otherwise). */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border bg-ink text-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="rounded bg-white px-2 py-1">
              <Logo href="/admin" />
            </span>
            <span className="text-sm font-medium uppercase tracking-wide text-white/70">Operator</span>
            <nav aria-label="Operator" className="hidden gap-1 sm:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="rounded bg-white px-2">
            <Suspense fallback={<span className="h-8 w-20" />}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
        <nav aria-label="Operator (mobile)" className="flex gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded px-3 py-1.5 text-sm text-white/80 hover:bg-white/10">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
