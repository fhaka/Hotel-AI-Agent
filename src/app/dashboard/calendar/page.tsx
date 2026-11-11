import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { addDays, isValidDate, todayInZone } from "@/lib/reservations/dates";
import { businessTimezone } from "@/lib/reservations/queries";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Calendar" };
const DAYS = 14;

/**
 * Occupancy grid: rooms × days. The hotel's PostgreSQL data is the source of
 * truth; no external calendar is involved.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/dashboard/calendar">) {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/calendar");
  if (workspace.industry !== "hotel") return <Alert tone="info">The calendar is available for hotel workspaces.</Alert>;
  const tz = await businessTimezone(workspace.businessId);
  const today = todayInZone(tz, new Date(ent.snapshot.evaluated_at));
  const sp = await searchParams;
  const startParam = typeof sp.start === "string" && isValidDate(sp.start) ? sp.start : today;
  const start = startParam;
  const end = addDays(start, DAYS);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));

  const supabase = await createClient();
  const [{ data: rooms }, { data: reservations }] = await Promise.all([
    supabase.from("rooms").select("id, room_number, status, room_types ( name )").eq("business_id", workspace.businessId).order("room_number"),
    supabase
      .from("reservations")
      .select("id, room_id, check_in, check_out, status, guests ( full_name )")
      .eq("business_id", workspace.businessId)
      .in("status", ["pending", "confirmed", "checked_in", "checked_out"])
      .lt("check_in", end)
      .gt("check_out", start),
  ]);
  type Res = { id: string; room_id: string; check_in: string; check_out: string; status: string; guests: { full_name: string } | null };
  const byRoom = new Map<string, Res[]>();
  for (const r of (reservations ?? []) as unknown as Res[]) byRoom.set(r.room_id, [...(byRoom.get(r.room_id) ?? []), r]);
  const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
  const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-muted">{monthFmt.format(new Date(`${start}T00:00:00Z`))} · each cell is one night</p>
        </div>
        <nav className="flex gap-2 text-sm" aria-label="Calendar navigation">
          <Link href={`/dashboard/calendar?start=${addDays(start, -7)}`} className="rounded-lg border border-border px-3 py-1.5 hover:bg-canvas">← Week</Link>
          <Link href="/dashboard/calendar" className="rounded-lg border border-border px-3 py-1.5 hover:bg-canvas">Today</Link>
          <Link href={`/dashboard/calendar?start=${addDays(start, 7)}`} className="rounded-lg border border-border px-3 py-1.5 hover:bg-canvas">Week →</Link>
        </nav>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2 text-left">Room</th>
              {days.map((d) => (
                <th key={d} className={cn("min-w-16 border-b border-l border-border px-1 py-2 font-medium", d === today && "bg-brand-50 text-brand-700")}>
                  {dayFmt.format(new Date(`${d}T00:00:00Z`))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rooms ?? []).map((room) => {
              const list = byRoom.get(room.id) ?? [];
              const cells: React.ReactNode[] = [];
              for (let i = 0; i < DAYS; ) {
                const night = days[i];
                const r = list.find((x) => x.check_in <= night && x.check_out > night);
                if (!r) {
                  cells.push(<td key={night} className={cn("h-10 border-b border-l border-border", room.status !== "available" && "bg-canvas")} />);
                  i += 1;
                  continue;
                }
                let span = 1;
                while (i + span < DAYS && r.check_out > days[i + span]) span += 1;
                cells.push(
                  <td key={night} colSpan={span} className="h-10 border-b border-l border-border p-0.5">
                    <Link
                      href={`/dashboard/reservations/${r.id}`}
                      className={cn(
                        "block h-full truncate rounded px-2 py-2 font-medium",
                        r.status === "checked_in" ? "bg-success-50 text-success-700" : r.status === "checked_out" ? "bg-canvas text-muted" : "bg-brand-100 text-brand-900",
                      )}
                      title={`${r.guests?.full_name ?? ""} · ${r.check_in} → ${r.check_out}`}
                    >
                      {r.guests?.full_name}
                    </Link>
                  </td>,
                );
                i += span;
              }
              return (
                <tr key={room.id}>
                  <th className="sticky left-0 z-10 whitespace-nowrap border-b border-border bg-surface px-3 py-2 text-left font-medium">
                    {room.room_number}
                    <span className="block font-normal text-subtle">{(room.room_types as unknown as { name: string } | null)?.name}{room.status !== "available" ? " · out of service" : ""}</span>
                  </th>
                  {cells}
                </tr>
              );
            })}
          </tbody>
        </table>
        {(rooms ?? []).length === 0 ? <p className="p-6 text-sm text-muted">No rooms configured yet.</p> : null}
      </Card>
    </div>
  );
}
