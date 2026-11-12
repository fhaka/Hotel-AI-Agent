import type { ReactNode } from "react";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { legalInfo } from "@/lib/legal";

/**
 * Shared frame for legal pages. They carry a visible draft notice until a
 * lawyer has reviewed them for the operator's jurisdiction (set
 * NEXT_PUBLIC_LEGAL_REVIEWED=true afterwards).
 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const info = legalInfo();
  const reviewed = process.env.NEXT_PUBLIC_LEGAL_REVIEWED === "true";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
        {!reviewed ? (
          <div role="note" className="mb-8 rounded-lg border border-warning-700/30 bg-warning-50 p-4 text-sm text-warning-700">
            Draft — this document has not yet been reviewed by a lawyer and may change before HotelAI launches publicly.
          </div>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">
          Last updated {updated} · {info.company}, {info.address} · <a className="underline" href={`mailto:${info.email}`}>{info.email}</a>
        </p>
        <div className="legal mt-8 space-y-4 text-[15px] leading-7 text-ink [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_table]:w-full [&_td]:border-t [&_td]:border-border [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-3 [&_th]:text-left [&_th]:text-sm">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
