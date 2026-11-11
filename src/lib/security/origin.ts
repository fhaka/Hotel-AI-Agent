/**
 * CSRF defence for cookie-authenticated JSON endpoints: only accept requests
 * whose Origin matches our canonical app URL (or, when a browser omits Origin,
 * that it declares itself same-origin via Sec-Fetch-Site).
 */
export function isSameOriginRequest(headers: Headers, appUrl: string): boolean {
  const expected = new URL(appUrl).origin;
  const origin = headers.get("origin");
  if (origin) return origin === expected;
  return headers.get("sec-fetch-site") === "same-origin";
}
