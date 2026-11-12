import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import { isGuestOnlyPath, isProtectedPath } from "@/lib/auth/redirect";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Refreshes the Supabase session cookie on every matched request and applies
 * coarse route protection. This is a convenience layer for redirects only —
 * authorization is enforced again on the server (DAL) and in the database (RLS).
 */
export async function updateSession(request: NextRequest, forwardHeaders: Record<string, string> = {}) {
  const env = getPublicEnv();
  // Re-created after cookie refresh, so the forwarded request carries both the
  // refreshed cookies and the extra headers (CSP nonce).
  const next = () => {
    const headers = new Headers(request.headers);
    for (const [k, v] of Object.entries(forwardHeaders)) headers.set(k, v);
    return NextResponse.next({ request: { headers } });
  };
  let response = next();

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = next();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Prevent CDNs from caching responses that set auth cookies.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // IMPORTANT: no code between createServerClient and getClaims(); this call
  // refreshes an expired access token and writes the new cookies.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!isSignedIn && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(url, response);
  }

  if (isSignedIn && isGuestOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
