import type { BusinessRole } from "./snapshot";

/**
 * Role-based permissions (what a role may do, independent of the plan).
 * Mirrors the RLS policies and SQL functions; the database remains the
 * authority, this drives server-side checks and what the UI offers.
 */
export const PERMISSIONS = {
  "workspace.view": ["owner", "admin", "manager", "staff"],
  "business.edit": ["owner", "admin"],
  "team.view": ["owner", "admin", "manager", "staff"],
  "team.manage": ["owner", "admin"],
  "agents.configure": ["owner", "admin"],
  "agents.use": ["owner", "admin", "manager", "staff"],
  "knowledge.edit": ["owner", "admin", "manager"],
  "rooms.configure": ["owner", "admin", "manager"],
  "reservations.manage": ["owner", "admin", "manager", "staff"],
  "billing.view": ["owner", "admin"],
  "billing.manage": ["owner"],
  "usage.view": ["owner", "admin"],
  "audit.view": ["owner", "admin"],
} as const satisfies Record<string, readonly BusinessRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: BusinessRole | undefined, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly BusinessRole[]).includes(role);
}

/** Which roles `actor` may assign or remove. Mirrors update_member_role(). */
export function manageableRoles(actor: BusinessRole | undefined): BusinessRole[] {
  if (actor === "owner") return ["owner", "admin", "manager", "staff"];
  if (actor === "admin") return ["manager", "staff"];
  return [];
}

/** Roles `actor` may invite. Owners are never invited directly. */
export function invitableRoles(actor: BusinessRole | undefined): BusinessRole[] {
  return manageableRoles(actor).filter((r) => r !== "owner");
}
