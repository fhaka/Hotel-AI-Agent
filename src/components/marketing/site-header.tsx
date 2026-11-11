import Link from "next/link";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav aria-label="Main" className="hidden gap-6 text-sm text-muted sm:flex">
            <Link href="/#how-it-works" className="hover:text-ink">How it works</Link>
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          </nav>
        </div>
        <nav className="flex items-center gap-2">
          <ButtonLink href="/auth/login" variant="ghost" size="sm">Sign in</ButtonLink>
          <ButtonLink href="/auth/sign-up" size="sm">Start free trial</ButtonLink>
        </nav>
      </div>
    </header>
  );
}
