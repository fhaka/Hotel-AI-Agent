import "server-only";
import { cookies } from "next/headers";
import type { CurrentUser } from "@/lib/auth/session";
import { listMyWorkspaces, type WorkspaceSummary } from "./queries";

/**
 * The active workspace is remembered in a cookie, but the cookie is only a
 * preference: it is always checked against the user's current memberships.
 * A forged or stale id simply falls back to the first workspace.
 */
export const ACTIVE_WORKSPACE_COOKIE = "hotelai_workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function getActiveWorkspace(
  user: CurrentUser,
): Promise<{ active: WorkspaceSummary | null; all: WorkspaceSummary[] }> {
  const [all, store] = await Promise.all([listMyWorkspaces(user), cookies()]);
  const preferred = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const active = all.find((w) => w.businessId === preferred) ?? all[0] ?? null;
  return { active, all };
}

/** Only call after verifying membership. Must run in a Server Action / Route Handler. */
export async function rememberActiveWorkspace(businessId: string) {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
