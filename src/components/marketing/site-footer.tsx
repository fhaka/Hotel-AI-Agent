import { cacheLife } from "next/cache";
import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
        <Logo />
        <nav aria-label="Footer" className="flex gap-6">
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/auth/login" className="hover:text-ink">Sign in</Link>
        </nav>
        <p>
          © <CopyrightYear /> HotelAI. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/** Prerendered and cached; revalidated daily so the year rolls over. */
async function CopyrightYear() {
  "use cache";
  cacheLife("days");
  return <>{new Date().getFullYear()}</>;
}
