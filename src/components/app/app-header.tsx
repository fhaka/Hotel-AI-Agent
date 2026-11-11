import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function AppHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Logo href="/dashboard" />
          <Suspense fallback={null}>
            <WorkspaceSwitcher />
          </Suspense>
        </div>
        <Suspense fallback={<span className="h-8 w-20" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}
