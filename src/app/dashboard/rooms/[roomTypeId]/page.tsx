import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addRate, addRooms, deleteRate, deleteRoom, saveRoomType, setRoomStatus } from "@/app/dashboard/rooms/actions";
import { AddRateForm, AddRoomsForm, DeleteRateButton, RoomRow, RoomTypeForm } from "@/components/rooms/room-forms";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/knowledge/context";
import { centsToInput } from "@/lib/onboarding/parsing";
import { formatStayDate } from "@/lib/reservations/dates";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Room type" };

export default async function RoomTypePage({ params, searchParams }: PageProps<"/dashboard/rooms/[roomTypeId]">) {
  const { roomTypeId } = await params;
  const { workspace, entitlements: ent } = await getWorkspaceContext(`/dashboard/rooms/${roomTypeId}`);
  if (!isUuid(roomTypeId)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: t } = await supabase.from("room_types").select("*").eq("id", roomTypeId).eq("business_id", workspace.businessId).maybeSingle();
  if (!t) notFound();
  const [{ data: rooms }, { data: rates }] = await Promise.all([
    supabase.from("rooms").select("id, room_number, status").eq("room_type_id", t.id).order("room_number"),
    supabase.from("room_type_rates").select("id, name, starts_on, ends_on, nightly_price_cents").eq("room_type_id", t.id).order("starts_on"),
  ]);
  const canEdit = ent.can("rooms.configure");
  const bid = workspace.businessId;

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/dashboard/rooms" className="text-sm text-muted hover:text-ink">← Rooms</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
      {sp.created === "1" ? <Alert tone="success">Room type created. Add its room numbers below.</Alert> : null}
      {!canEdit ? <Alert tone="info">Owners, admins and managers can change rooms.</Alert> : null}

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold">Details</h2>
        {canEdit ? (
          <RoomTypeForm
            action={saveRoomType.bind(null, bid, t.id)}
            defaults={{
              name: t.name,
              description: t.description ?? "",
              maximumGuests: String(t.maximum_guests),
              bedConfiguration: t.bed_configuration ?? "",
              amenities: t.amenities.join(", "),
              price: centsToInput(t.base_price_cents),
              isActive: t.is_active,
            }}
            submitLabel="Save room type"
          />
        ) : (
          <p className="text-sm text-muted">Up to {t.maximum_guests} guests · base {formatCurrency(t.base_price_cents, t.currency)}/night</p>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="mb-2 text-base font-semibold">Rooms</h2>
        {(rooms ?? []).length === 0 ? <p className="text-sm text-muted">No rooms yet.</p> : (
          <ul className="divide-y divide-border">
            {(rooms ?? []).map((r) =>
              canEdit ? (
                <RoomRow key={r.id} roomId={r.id} roomNumber={r.room_number} status={r.status} statusAction={setRoomStatus.bind(null, t.id)} deleteAction={deleteRoom.bind(null, t.id)} />
              ) : (
                <li key={r.id} className="py-2 text-sm">Room {r.room_number} · {r.status.replace("_", " ")}</li>
              ),
            )}
          </ul>
        )}
        {canEdit ? <div className="mt-4 border-t border-border pt-4"><AddRoomsForm action={addRooms.bind(null, bid, t.id)} /></div> : null}
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-base font-semibold">Seasonal rates</h2>
        <p className="mb-4 text-sm text-muted">Override the base price for specific nights. Rates can&apos;t overlap.</p>
        {(rates ?? []).length === 0 ? <p className="text-sm text-muted">No seasonal rates. The base price applies every night.</p> : (
          <ul className="mb-4 divide-y divide-border text-sm">
            {(rates ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {r.name ? <span className="font-medium">{r.name}: </span> : null}
                  nights {formatStayDate(r.starts_on)} – {formatStayDate(r.ends_on)} (exclusive) · {formatCurrency(r.nightly_price_cents, t.currency)}/night
                </span>
                {canEdit ? <DeleteRateButton rateId={r.id} action={deleteRate.bind(null, t.id)} /> : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? <AddRateForm action={addRate.bind(null, bid, t.id)} /> : null}
      </Card>
    </div>
  );
}
