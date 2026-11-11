import type { Metadata } from "next";
import Link from "next/link";
import { saveRoomType } from "@/app/dashboard/rooms/actions";
import { RoomTypeForm } from "@/components/rooms/room-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/knowledge/context";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Rooms" };

export default async function RoomsPage() {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/rooms");
  if (workspace.industry !== "hotel") return <Alert tone="info">Rooms are available for hotel workspaces.</Alert>;
  const supabase = await createClient();
  const [{ data: types }, { data: rooms }] = await Promise.all([
    supabase.from("room_types").select("id, name, maximum_guests, base_price_cents, currency, is_active").eq("business_id", workspace.businessId).order("base_price_cents"),
    supabase.from("rooms").select("room_type_id, status").eq("business_id", workspace.businessId),
  ]);
  const canEdit = ent.can("rooms.configure");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rooms</h1>
        <p className="mt-1 text-sm text-muted">Room types, individual rooms and seasonal prices. Availability and AI quotes use exactly this data.</p>
      </div>
      {(types ?? []).length === 0 ? <Card className="p-8 text-center text-sm text-muted">No room types yet.</Card> : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(types ?? []).map((t) => {
            const own = (rooms ?? []).filter((r) => r.room_type_id === t.id);
            const available = own.filter((r) => r.status === "available").length;
            return (
              <li key={t.id}>
                <Link href={`/dashboard/rooms/${t.id}`} className="block h-full">
                  <Card className="h-full p-5 hover:border-brand-200">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold">{t.name}</h2>
                      {!t.is_active ? <Badge tone="warning">Inactive</Badge> : null}
                    </div>
                    <p className="mt-2 text-sm text-muted">Up to {t.maximum_guests} guests · base {formatCurrency(t.base_price_cents, t.currency)}/night</p>
                    <p className="mt-1 text-sm text-muted">{own.length} room{own.length === 1 ? "" : "s"} ({available} in service)</p>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit ? (
        <Card className="p-6">
          <details>
            <summary className="cursor-pointer font-semibold">Add a room type</summary>
            <div className="mt-4">
              <RoomTypeForm
                action={saveRoomType.bind(null, workspace.businessId, null)}
                defaults={{ name: "", description: "", maximumGuests: "2", bedConfiguration: "", amenities: "", price: "", isActive: true }}
                submitLabel="Create room type"
              />
            </div>
          </details>
        </Card>
      ) : <Alert tone="info">Owners, admins and managers can change rooms.</Alert>}
    </div>
  );
}
