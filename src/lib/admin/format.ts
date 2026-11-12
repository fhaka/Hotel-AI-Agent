/** Formatting for the operator area (UTC, since operators span time zones). */
export function fmtDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toISOString().slice(0, 10);
  return withTime ? `${date} ${d.toISOString().slice(11, 16)} UTC` : date;
}

export function fmtNumber(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(n) : "—";
}

export function fmtMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export type StatusTone = "neutral" | "brand" | "success" | "warning" | "danger";

export function statusTone(status: string | null | undefined, suspended = false): StatusTone {
  if (suspended) return "danger";
  switch (status) {
    case "active":
      return "success";
    case "trialing":
      return "brand";
    case "past_due":
    case "canceled":
      return "warning";
    case "expired":
    case "paused":
      return "danger";
    default:
      return "neutral";
  }
}
