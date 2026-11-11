import { Suspense } from "react";
import { AppHeader } from "@/components/app/app-header";
import { Sidebar } from "@/components/app/sidebar";
import { SidebarNavList } from "@/components/app/sidebar-nav";
import { WorkspaceBanner } from "@/components/app/workspace-banner";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col md:flex-row">
        <aside className="border-b border-border bg-surface px-4 py-3 md:w-56 md:shrink-0 md:border-b-0 md:border-r md:py-6">
          <Suspense fallback={<SidebarNavList pathname={null} />}>
            <Sidebar />
          </Suspense>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6">
          <Suspense fallback={null}>
            <WorkspaceBanner />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}
