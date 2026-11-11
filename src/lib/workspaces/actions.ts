"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid, rememberActiveWorkspace } from "./active";
import { listMyWorkspaces } from "./queries";

/** Switches the active workspace after re-verifying membership on the server. */
export async function switchWorkspace(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");
  const businessId = formData.get("businessId");
  if (!isUuid(businessId)) redirect("/dashboard");
  const workspaces = await listMyWorkspaces(user);
  if (workspaces.some((w) => w.businessId === businessId)) {
    await rememberActiveWorkspace(businessId);
  }
  redirect("/dashboard");
}
