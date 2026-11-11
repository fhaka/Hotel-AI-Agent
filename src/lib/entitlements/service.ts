import "server-only";
import type { CurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { summarizeEntitlements, type DenialCode, type Entitlements } from "./evaluate";
import { entitlementSnapshotSchema } from "./snapshot";

export class EntitlementError extends Error {
  constructor(
    public readonly code: DenialCode | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "EntitlementError";
  }
}

/**
 * THE central entitlement check. Identity comes from the verified session
 * (`user` must come from getCurrentUser/requireUser, never from a request
 * body). The database verifies membership via auth.uid() and evaluates the
 * subscription against its own clock; nothing here can be influenced by the
 * browser.
 */
export async function getBusinessEntitlements(businessId: string, user: CurrentUser): Promise<Entitlements> {
  void user; // identity is enforced by the session-bound client below (auth.uid())
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_business_entitlements", { p_business_id: businessId });
  if (error) {
    if (error.code === "42501" || error.code === "28000") {
      throw new EntitlementError("not_member", "You are not a member of this workspace.");
    }
    console.error("[entitlements] lookup failed", { code: error.code });
    throw new EntitlementError("unavailable", "Could not verify your workspace access. Please try again.");
  }
  const parsed = entitlementSnapshotSchema.safeParse(data);
  if (!parsed.success) {
    // Fail closed: an unexpected shape never grants access.
    console.error("[entitlements] unexpected snapshot shape", parsed.error.issues.slice(0, 3));
    throw new EntitlementError("unavailable", "Could not verify your workspace access. Please try again.");
  }
  return summarizeEntitlements(parsed.data);
}
