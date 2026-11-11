/**
 * Builds the business-knowledge block given to AI agents (Phase 5).
 *
 * Pure function: no I/O. The caller loads data for ONE business, already
 * scoped by business_id (and by RLS for user sessions).
 *
 * Safety properties:
 *  - Everything is wrapped in <business_knowledge> … </business_knowledge>.
 *    The runtime's system prompt tells the model this block is reference
 *    DATA, never instructions.
 *  - Any text that imitates the delimiters is neutralized, so content cannot
 *    "close" the block and smuggle in instructions.
 *  - Control characters are stripped; total size is capped by a budget, with
 *    lower-priority entries omitted (and reported) rather than cut mid-way.
 *  - Room prices are labelled as base prices; availability is never stated
 *    here (it must come from the booking tools).
 */

export type DayHours = { mode: "closed" } | { mode: "open_24h" } | { mode: "hours"; opens: string; closes: string };

export type KnowledgeSources = {
  business: {
    name: string;
    industry: string;
    description: string | null;
    contact_email: string | null;
    phone: string | null;
    website: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    timezone: string;
    default_language: string;
    supported_languages: string[];
  };
  settings: {
    opening_hours: unknown;
    policies: unknown;
    booking_settings: unknown;
  } | null;
  roomTypes: {
    name: string;
    description: string | null;
    maximum_guests: number;
    bed_configuration: string | null;
    amenities: string[];
    base_price_cents: number;
    currency: string;
    is_active: boolean;
  }[];
  entries: { id: string; title: string; content: string; category: string }[];
};

export type KnowledgeContext = {
  text: string;
  charCount: number;
  includedEntryIds: string[];
  omittedEntryIds: string[];
  truncated: boolean;
};

export const DEFAULT_CONTEXT_BUDGET = 24_000;

const OPEN_TAG = "<business_knowledge>";
const CLOSE_TAG = "</business_knowledge>";

const DAYS: [string, string][] = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
];

const POLICY_LABELS: [string, string][] = [
  ["general", "General policies"],
  ["contact_instructions", "How to reach a person"],
  ["cancellation", "Cancellation"],
  ["breakfast", "Breakfast"],
  ["parking", "Parking"],
  ["wifi", "Wi-Fi"],
  ["pets", "Pets"],
  ["extra_services", "Extra services"],
];

/** Entry categories in priority order (earlier = kept first under budget pressure). */
const ENTRY_ORDER: [string, string][] = [
  ["faq", "Frequently asked questions"],
  ["policies", "Additional policies"],
  ["pricing", "Prices"],
  ["services", "Services"],
  ["hours", "Facility hours"],
  ["hotel", "Hotel information"],
  ["company", "About the business"],
  ["other", "Other information"],
];

/** Removes control characters and neutralizes delimiter look-alikes. */
export function sanitizeKnowledgeText(value: string): string {
  return (
    value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/<\s*\/?\s*business_knowledge[^>]*>/gi, "[removed tag]")
      .trim()
  );
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? sanitizeKnowledgeText(value) : null;
}

export function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function hoursLines(openingHours: unknown): string[] {
  const hours = obj(openingHours);
  const lines: string[] = [];
  for (const [key, label] of DAYS) {
    const d = obj(hours[key]);
    if (d.mode === "closed") lines.push(`${label}: closed`);
    else if (d.mode === "open_24h") lines.push(`${label}: open 24 hours`);
    else if (d.mode === "hours" && typeof d.opens === "string" && typeof d.closes === "string") {
      lines.push(`${label}: ${d.opens}–${d.closes}`);
    }
  }
  return lines;
}

export function formatKnowledgeContext(src: KnowledgeSources, budget = DEFAULT_CONTEXT_BUDGET): KnowledgeContext {
  const b = src.business;
  const isHotel = b.industry === "hotel";
  const core: string[] = [];

  // 1. Business profile (always included).
  const profile = [
    `Name: ${sanitizeKnowledgeText(b.name)}`,
    str(b.description) && `Description: ${str(b.description)}`,
    [b.address, b.city, b.country].some(Boolean) &&
      `Location: ${[b.address, b.city, b.country].filter(Boolean).map((x) => sanitizeKnowledgeText(x!)).join(", ")}`,
    str(b.contact_email) && `Email: ${str(b.contact_email)}`,
    str(b.phone) && `Phone: ${str(b.phone)}`,
    str(b.website) && `Website: ${str(b.website)}`,
    `Time zone: ${b.timezone}`,
    `Languages: ${b.supported_languages.join(", ")} (main: ${b.default_language})`,
  ].filter(Boolean);
  core.push(`## Business\n${profile.join("\n")}`);

  // 2. Hours.
  const hours = hoursLines(src.settings?.opening_hours);
  if (hours.length) core.push(`## ${isHotel ? "Reception hours" : "Opening hours"}\n${hours.join("\n")}`);

  // 3. Stay details (hotels).
  const booking = obj(src.settings?.booking_settings);
  if (isHotel && (booking.check_in_time || booking.check_out_time)) {
    const parts = [
      str(booking.check_in_time) && `Check-in from ${str(booking.check_in_time)}`,
      str(booking.check_out_time) && `check-out by ${str(booking.check_out_time)}`,
    ].filter(Boolean);
    core.push(`## Stay details\n${parts.join("; ")}.`);
  }

  // 4. Structured policies.
  const policies = obj(src.settings?.policies);
  const policyLines = POLICY_LABELS.flatMap(([key, label]) => {
    const v = str(policies[key]);
    return v ? [`- ${label}: ${v}`] : [];
  });
  if (policyLines.length) core.push(`## Policies\n${policyLines.join("\n")}`);

  // 5. Room types (hotels): descriptive only — never availability.
  const rooms = src.roomTypes.filter((r) => r.is_active);
  if (isHotel && rooms.length) {
    const lines = rooms.map((r) => {
      const bits = [
        `up to ${r.maximum_guests} guest${r.maximum_guests === 1 ? "" : "s"}`,
        str(r.bed_configuration),
        r.amenities.length ? `amenities: ${r.amenities.map(sanitizeKnowledgeText).join(", ")}` : null,
        `base price ${formatCurrency(r.base_price_cents, r.currency)} per night`,
      ].filter(Boolean);
      const desc = str(r.description);
      return `- ${sanitizeKnowledgeText(r.name)}: ${bits.join("; ")}${desc ? `. ${desc}` : ""}`;
    });
    core.push(
      `## Room types\n${lines.join("\n")}\nNote: base prices may change by date. Availability and final prices must always be checked with the booking tools.`,
    );
  }

  // 6. Knowledge-base entries, by category priority, until the budget is used.
  let used = OPEN_TAG.length + CLOSE_TAG.length + core.join("\n\n").length + 2;
  const included: string[] = [];
  const omitted: string[] = [];
  const entrySections: string[] = [];

  for (const [category, heading] of ENTRY_ORDER) {
    const entries = src.entries.filter((e) => e.category === category);
    if (!entries.length) continue;
    const blocks: string[] = [];
    let headerCost = heading.length + 6;
    for (const e of entries) {
      const title = sanitizeKnowledgeText(e.title);
      const content = sanitizeKnowledgeText(e.content);
      const block = category === "faq" ? `Q: ${title}\nA: ${content}` : `### ${title}\n${content}`;
      const cost = block.length + 2 + headerCost;
      if (used + cost > budget) {
        omitted.push(e.id);
        continue;
      }
      used += cost;
      headerCost = 0;
      blocks.push(block);
      included.push(e.id);
    }
    if (blocks.length) entrySections.push(`## ${heading}\n${blocks.join("\n\n")}`);
  }

  const text = `${OPEN_TAG}\n${[...core, ...entrySections].join("\n\n")}\n${CLOSE_TAG}`;
  return { text, charCount: text.length, includedEntryIds: included, omittedEntryIds: omitted, truncated: omitted.length > 0 };
}
