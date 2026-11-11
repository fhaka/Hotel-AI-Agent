import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-tight text-ink">
      <span
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white"
      >
        H
      </span>
      <span>
        Hotel<span className="text-brand-600">AI</span>
      </span>
    </Link>
  );
}
