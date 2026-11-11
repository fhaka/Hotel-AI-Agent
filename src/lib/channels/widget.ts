import { createHash, randomBytes } from "node:crypto";

/** Visitor tokens: random, kept by the visitor; only the hash is stored. */
export const WIDGET_TOKEN = /^[0-9a-f]{48}$/;
export const WIDGET_KEY = /^wk_[0-9a-f]{32}$/;

export function newWidgetToken(): string {
  return randomBytes(24).toString("hex");
}

export function widgetRef(token: string): string {
  return "wt_" + createHash("sha256").update(token).digest("hex").slice(0, 40);
}

/** Only origins in strict scheme://host[:port] form are allowed in the CSP header. */
export function safeOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((o): o is string => typeof o === "string" && /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o))
    .slice(0, 10);
}

export function frameAncestors(origins: string[]): string {
  return `frame-ancestors 'self'${origins.length ? " " + origins.join(" ") : ""}`;
}

/** Hash of the client IP for rate limiting (raw IPs are never stored). */
export function ipKey(forwardedFor: string | null): string {
  const ip = (forwardedFor ?? "").split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`ip:${ip}`).digest("hex").slice(0, 32);
}
