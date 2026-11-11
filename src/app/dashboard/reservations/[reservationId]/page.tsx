import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  cancelReservation,
  changeStatus,
  modifyReservation,
  resendConfirmation,
  updateSpecialRequests,
} from "@/app/dashboard/reservations/actions";
import { CancelForm, ModifyForm, NotesForm, ResendButton, StatusButtons } from "@/components/reservations/reservation-actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatInZone } from "@/lib/billing/trial";
import { emailConfigured } from "@/lib/email/send";
import { formatCurrency } from "@/lib/knowledge/context";
import { formatStayDate, nightsBetween, todayInZone } from "@/lib/reservations/dates";
import { businessTimezone } from "@/lib/reservations/queries";
import { SOURCE_LABEL, STATUS_INFO, isAiSource, nextStatuses } from "@/lib/reservations/status";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Reservation" };

const EMAIL_NOTICE: Record<string, { tone: "success" | "warning"; text: string }> = {
  sent: { tone: "success", text: "Reservation created and confirmation emailed to the guest." },
  not_configured: { tone: "warning", text: "Reservation created. No email was sent: email sending is not configured." },
  no_guest_email: { tone: "warning", text: "Reservation created. No email was sent: the guest has no email address." },
  failed: { tone: "warning", text: "Reservation created, but the confirmation email failed. You can resend it below." },
  none: { tone: "success", text: "Reservation created." },
};

export default async function ReservationPage({ params, searchParams }: PageProps<"/dashboard/reservations/[reservationId]">) {
  const { reservationId } = await params;
  const { workspace, entitlements: ent } = await getWorkspaceContext(`/dashboard/reservations/${reservationId}`);
  if (!isUuid(reservationId)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("reservations")
    .select("*, guests ( id, full_name, email, phone, preferred_language ), rooms ( room_number, room_types ( name ) )")
    .eq("id", reservationId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  if (!r) notFound();
  const [{ data: events }, tz] = await Promise.all([
    supabase.from("reservation_events").select("id, event_type, from_status, to_status, metadata, created_at").eq("reservation_id", r.id).order("id"),
    businessTimezone(workspace.businessId),
  ]);
  const today = todayInZone(tz, new Date(ent.snapshot.evaluated_at));
  const guest = r.guests as unknown as { id: string; full_name: string; email: string | null; phone: string | null; preferred_language: string | null };
  const room = r.rooms as unknown as { room_number: string; room_types: { name: string } | null } | null;
  const next = nextStatuses(r.status, today, r.check_in);
  const editable = r.status === "pending" || r.status === "confirmed";
  const created = sp.created === "1" ? EMAIL_NOTICE[String(sp.email ?? "none")] ?? EMAIL_NOTICE.none : null;
  const mail = emailConfigured();

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/dashboard/reservations" className="text-sm text-muted hover:text-ink">← Reservations</Link>
      {created ? <Alert tone={created.tone}>{created.text}</Alert> : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{guest.full_name}</h1>
          <p className="mt-1 font-mono text-sm text-muted">Confirmation {r.confirmation_reference}</p>
        </div>
        <div className="flex gap-2">
          <Badge tone={STATUS_INFO[r.status].tone}>{STATUS_INFO[r.status].label}</Badge>
          {isAiSource(r.source) ? <Badge tone="brand">Booked by {SOURCE_LABEL[r.source]}</Badge> : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card className="p-6">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Check-in</dt><dd className="font-medium">{formatStayDate(r.check_in)}</dd></div>
              <div><dt className="text-muted">Check-out</dt><dd className="font-medium">{formatStayDate(r.check_out)}</dd></div>
              <div><dt className="text-muted">Nights · guests</dt><dd className="font-medium">{nightsBetween(r.check_in, r.check_out)} · {r.guests_count}</dd></div>
              <div><dt className="text-muted">Room</dt><dd className="font-medium">{room?.room_types?.name} · {room?.room_number}</dd></div>
              <div><dt className="text-muted">Total</dt><dd className="font-medium">{formatCurrency(r.total_price_cents, r.currency)}</dd></div>
              <div><dt className="text-muted">Source</dt><dd className="font-medium">{SOURCE_LABEL[r.source]}</dd></div>
            </dl>
            {r.status === "canceled" && r.cancellation_reason ? <p className="mt-4 text-sm text-muted">Cancellation reason: {r.cancellation_reason}</p> : null}
          </Card>

          <Card className="space-y-4 p-6">
            <h2 className="text-base font-semibold">Actions</h2>
            <StatusButtons action={changeStatus.bind(null, r.id)} next={next} />
            {editable ? (
              <>
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-semibold">Change dates or guests</h3>
                  <ModifyForm action={modifyReservation.bind(null, r.id)} defaults={{ checkIn: r.check_in, checkOut: r.check_out, guests: r.guests_count }} today={today} />
                </div>
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-semibold">Cancel</h3>
                  <CancelForm action={cancelReservation.bind(null, r.id)} emailConfigured={mail} />
                </div>
              </>
            ) : null}
            <div className="border-t border-border pt-4">
              <NotesForm action={updateSpecialRequests.bind(null, r.id)} value={r.special_requests ?? ""} />
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 text-base font-semibold">History</h2>
            <ol className="space-y-2 text-sm">
              {(events ?? []).map((e) => {
                const meta = (e.metadata ?? {}) as Record<string, unknown>;
                const text =
                  e.event_type === "created"
                    ? `Created (${SOURCE_LABEL[(meta.source as keyof typeof SOURCE_LABEL) ?? "other"] ?? "unknown source"})`
                    : e.event_type === "status_changed"
                      ? `Status: ${e.from_status ? STATUS_INFO[e.from_status].label : "?"} → ${e.to_status ? STATUS_INFO[e.to_status].label : "?"}${meta.reason ? ` (${String(meta.reason)})` : ""}`
                      : e.event_type === "modified"
                        ? "Dates, guests or room changed; price recalculated"
                        : `Email (${String(meta.kind)}): ${String(meta.status)}`;
                return (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-44 shrink-0 text-muted">{formatInZone(new Date(e.created_at), tz)}</span>
                    <span>{text}</span>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="space-y-2 p-6 text-sm">
            <h2 className="text-base font-semibold">Guest</h2>
            <p className="font-medium">{guest.full_name}</p>
            {guest.email ? <p><a href={`mailto:${guest.email}`} className="text-brand-600">{guest.email}</a></p> : <p className="text-muted">No email</p>}
            {guest.phone ? <p>{guest.phone}</p> : null}
            <Link href={`/dashboard/guests/${guest.id}`} className="inline-block text-brand-600 hover:text-brand-700">Guest profile →</Link>
          </Card>
          {guest.email && r.status !== "canceled" ? (
            <Card className="p-6">
              <ResendButton action={resendConfirmation.bind(null, r.id)} />
              {!mail ? <p className="mt-2 text-xs text-muted">Email sending is not configured.</p> : null}
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
