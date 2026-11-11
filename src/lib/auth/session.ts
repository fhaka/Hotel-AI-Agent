import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer for identity. All server code obtains the current user
 * through these functions; nothing trusts a user id sent by the browser.
 */

export type CurrentUser = {
  id: string;
  email: string | null;
};

/**
 * Returns the verified current user, or null. Uses getClaims(), which
 * validates the JWT signature (locally with asymmetric keys, otherwise via the
 * Auth server) instead of trusting the cookie contents.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
}

/** Like getCurrentUser() but redirects to login when signed out. */
export async function requireUser(nextPath = "/dashboard"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}
