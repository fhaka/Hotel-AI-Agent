import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { UserMenu } from "./user-menu";

export function AppHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo href="/dashboard" />
        <Suspense fallback={<span className="h-8 w-20" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}
