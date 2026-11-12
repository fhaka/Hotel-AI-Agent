import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Operator area guard. Non-admins get a 404 so the area's existence isn't
 * revealed. This is a convenience check for rendering: every admin database
 * function verifies platform_admins again on its own.
 */
export async function requirePlatformAdmin(path: string) {
  const user = await requireUser(path);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error || data !== true) notFound();
  return { user, supabase };
}
