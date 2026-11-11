/**
 * Validates a post-login redirect target taken from the URL (`?next=`).
 * Only same-origin relative paths are allowed, preventing open redirects such
 * as `?next=https://evil.example` or `?next=//evil.example`.
 */
export function safeRedirectPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith("/")) return fallback;
  // Protocol-relative (//host) and backslash variants (/\host) are treated as
  // absolute URLs by browsers.
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Reject control characters, which browsers may strip to form `//`.
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const parsed = new URL(next, "http://placeholder.invalid");
    if (parsed.origin !== "http://placeholder.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/** Routes that require a signed-in user. Enforced in src/proxy.ts and again on the server. */
export const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/admin"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Auth pages a signed-in user should be bounced away from. */
export const GUEST_ONLY_PATHS = ["/auth/login", "/auth/sign-up", "/auth/forgot-password"] as const;

export function isGuestOnlyPath(pathname: string): boolean {
  return (GUEST_ONLY_PATHS as readonly string[]).includes(pathname);
}
