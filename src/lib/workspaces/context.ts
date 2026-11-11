import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getBusinessEntitlements } from "@/lib/entitlements/service";
import { getActiveWorkspace } from "./active";

/**
 * Resolves the signed-in user, their active workspace (membership verified)
 * and its entitlements. Pages in /dashboard/* use this; users without a
 * workspace are sent to the dashboard, which offers to create one.
 */
export async function getWorkspaceContext(path: string) {
  const user = await requireUser(path);
  const { active, all } = await getActiveWorkspace(user);
  if (!active) redirect("/dashboard");
  const entitlements = await getBusinessEntitlements(active.businessId, user);
  return { user, workspace: active, workspaces: all, entitlements };
}

export type WorkspaceContext = Awaited<ReturnType<typeof getWorkspaceContext>>;
