import { cn } from "@/lib/cn";

export function UsageMeter({ label, used, limit, unit }: { label: string; used: number; limit: number | null; unit?: string }) {
  const ratio = limit === null ? 0 : limit === 0 ? 1 : Math.min(used / limit, 1);
  const pct = Math.round(ratio * 100);
  const fmt = new Intl.NumberFormat("en");
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted">
          {fmt.format(used)}
          {limit === null ? " (no limit)" : ` / ${fmt.format(limit)}`} {unit}
        </span>
      </div>
      {limit !== null ? (
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-canvas"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
        >
          <div
            className={cn("h-full rounded-full", pct >= 100 ? "bg-danger-600" : pct >= 80 ? "bg-warning-700" : "bg-brand-600")}
            style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
