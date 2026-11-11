/** Pure parsing helpers for onboarding form input. */

/**
 * Converts a user-entered price ("120", "120.5", "1,250.00", "99,90") to
 * integer minor units (cents). Returns null for invalid input. Floats are
 * never used, so there is no rounding error.
 */
export function parsePriceToCents(input: string): number | null {
  let s = input.trim().replace(/\s/g, "");
  if (!s) return null;
  // "1.250,50" / "99,90" (comma decimal) vs "1,250.50" (comma thousands)
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + fraction;
}

export function formatCents(cents: number, currency = "EUR", locale = "en"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** Plain decimal string for re-filling a price input ("120.00"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const MAX_ROOMS_PER_RANGE = 200;

/**
 * Parses room numbers like "101, 102, 201-205, A1" into a list.
 * Numeric ranges keep zero padding ("01-03" -> 01, 02, 03).
 * Returns an error message for invalid input.
 */
export function parseRoomNumbers(input: string): { rooms: string[] } | { error: string } {
  const rooms: string[] = [];
  for (const raw of input.split(/[,;\n]/)) {
    const part = raw.trim();
    if (!part) continue;
    const range = /^(\d{1,6})\s*-\s*(\d{1,6})$/.exec(part);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to < from) return { error: `Range "${part}" goes backwards` };
      if (to - from + 1 > MAX_ROOMS_PER_RANGE) return { error: `Range "${part}" is too large` };
      const width = range[1].length === range[2].length ? range[1].length : 0;
      for (let n = from; n <= to; n++) rooms.push(width ? String(n).padStart(width, "0") : String(n));
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,19}$/.test(part)) {
      return { error: `"${part}" is not a valid room number` };
    }
    rooms.push(part);
  }
  if (rooms.length === 0) return { error: "Enter at least one room number" };
  const seen = new Set<string>();
  for (const r of rooms) {
    if (seen.has(r)) return { error: `Room ${r} is listed twice` };
    seen.add(r);
  }
  return { rooms };
}

/** Splits a comma/newline separated list, trimming and de-duplicating. */
export function parseList(input: string, maxItems = 30): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const item = raw.trim();
    if (item && !out.includes(item)) out.push(item);
  }
  return out.slice(0, maxItems);
}
