import { getCurrentUser } from "@/lib/auth/session";
import { getActiveWorkspace } from "@/lib/workspaces/active";
import { SidebarNav } from "./sidebar-nav";

/** Resolves the active workspace's industry to decide which sections apply. Render in <Suspense>. */
export async function Sidebar() {
  const user = await getCurrentUser();
  const active = user ? (await getActiveWorkspace(user)).active : null;
  return <SidebarNav isHotel={active?.industry === "hotel"} />;
}
