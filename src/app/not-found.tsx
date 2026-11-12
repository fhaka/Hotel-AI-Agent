import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The page doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/" className={buttonClasses("primary", "md", "mt-6")}>
        Go to the homepage
      </Link>
    </div>
  );
}
