import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * PRIVILEGED client using the Supabase secret key. It BYPASSES Row Level
 * Security. Use only in trusted server code that has already authorized the
 * operation (e.g. verified billing webhooks, background jobs) and always
 * scope queries by a business_id resolved on the server — never one taken
 * from the request body.
 */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const { SUPABASE_SECRET_KEY } = getServerEnv();
  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
