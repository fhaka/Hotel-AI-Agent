import type { Metadata } from "next";
import Link from "next/link";
import { createReservation, searchAvailability } from "@/app/dashboard/reservations/actions";
import { NewReservation } from "@/components/reservations/new-reservation";
import { Alert } from "@/components/ui/alert";
import { emailConfigured } from "@/lib/email/send";
import { todayInZone } from "@/lib/reservations/dates";
import { businessTimezone } from "@/lib/reservations/queries";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "New reservation" };

export default async function NewReservationPage() {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/reservations/new");
  const tz = await businessTimezone(workspace.businessId);
  const today = todayInZone(tz, new Date(ent.snapshot.evaluated_at));

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/dashboard/reservations" className="text-sm text-muted hover:text-ink">
        ← Reservations
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New reservation</h1>
      {workspace.industry !== "hotel" ? (
        <Alert tone="info">Reservations are available for hotel workspaces.</Alert>
      ) : !ent.canCreateReservations ? (
        <Alert tone="warning">{ent.inactiveReason?.message ?? "Your plan does not allow creating reservations."}</Alert>
      ) : (
        <NewReservation
          searchAction={searchAvailability.bind(null, workspace.businessId)}
          createAction={createReservation.bind(null, workspace.businessId)}
          today={today}
          emailConfigured={emailConfigured()}
        />
      )}
    </div>
  );
}
