import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateGuest } from "@/app/dashboard/guests/actions";
import { GuestForm } from "@/components/guests/guest-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/knowledge/context";
import { formatStayDate } from "@/lib/reservations/dates";
import { STATUS_INFO, isAiSource } from "@/lib/reservations/status";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Guest" };

export default async function GuestPage({ params }: PageProps<"/dashboard/guests/[guestId]">) {
  const { guestId } = await params;
  const { workspace } = await getWorkspaceContext(`/dashboard/guests/${guestId}`);
  if (!isUuid(guestId)) notFound();
  const supabase = await createClient();
  const { data: g } = await supabase.from("guests").select("*").eq("id", guestId).eq("business_id", workspace.businessId).maybeSingle();
  if (!g) notFound();
  const { data: stays } = await supabase
    .from("reservations")
    .select("id, confirmation_reference, check_in, check_out, status, source, total_price_cents, currency")
    .eq("guest_id", g.id)
    .order("check_in", { ascending: false })
    .limit(100);

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/dashboard/guests" className="text-sm text-muted hover:text-ink">← Guests</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{g.full_name}</h1>
      <Card className="p-6">
        <GuestForm
          action={updateGuest.bind(null, g.id)}
          defaults={{ fullName: g.full_name, email: g.email ?? "", phone: g.phone ?? "", preferredLanguage: g.preferred_language ?? "", notes: g.notes ?? "" }}
        />
      </Card>
      <Card>
        <h2 className="border-b border-border px-6 py-4 text-base font-semibold">Booking history ({stays?.length ?? 0})</h2>
        {(stays ?? []).length === 0 ? <p className="px-6 py-6 text-sm text-muted">No reservations.</p> : (
          <ul className="divide-y divide-border">
            {(stays ?? []).map((r) => (
              <li key={r.id}>
                <Link href={`/dashboard/reservations/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm hover:bg-canvas">
                  <span>{formatStayDate(r.check_in)} → {formatStayDate(r.check_out)} · <span className="font-mono text-xs text-muted">{r.confirmation_reference}</span></span>
                  <span className="flex items-center gap-2">
                    {formatCurrency(r.total_price_cents, r.currency)}
                    {isAiSource(r.source) ? <Badge tone="brand">AI</Badge> : null}
                    <Badge tone={STATUS_INFO[r.status].tone}>{STATUS_INFO[r.status].label}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
