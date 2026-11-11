import type { Metadata } from "next";
import { changeMemberRole, inviteMember, removeMember, revokeInvitation } from "@/app/dashboard/team/actions";
import { InviteForm } from "@/components/team/invite-form";
import { RemoveMember, RevokeInvitation, RoleSelect } from "@/components/team/member-controls";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { invitableRoles, manageableRoles } from "@/lib/entitlements/permissions";
import { listMembers, listPendingInvitations } from "@/lib/team/queries";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { user, workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/team");
  const canManage = ent.can("team.manage");
  const [members, invitations] = await Promise.all([
    listMembers(workspace.businessId),
    canManage ? listPendingInvitations(workspace.businessId) : Promise.resolve([]),
  ]);
  const manageable = manageableRoles(ent.role);
  const seats = ent.usage.members;
  const bid = workspace.businessId;
  const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-muted">
          {seats.limit === null ? `${seats.used} seats used` : `${seats.used} of ${seats.limit} seats used`} (pending invitations included).
        </p>
      </div>

      {canManage ? (
        <Card className="p-6">
          <h2 className="mb-4 text-base font-semibold">Invite a team member</h2>
          {ent.canInviteMembers ? (
            <InviteForm action={inviteMember.bind(null, bid)} roles={invitableRoles(ent.role)} />
          ) : (
            <Alert tone="warning">
              {ent.accessActive
                ? "All seats in your plan are in use. Remove a member or revoke an invitation to invite someone else."
                : "Inviting members requires an active plan or trial."}
            </Alert>
          )}
        </Card>
      ) : null}

      <Card>
        <h2 className="border-b border-border px-6 py-4 text-base font-semibold">Members</h2>
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const isSelf = m.userId === user.id;
            const label = m.name ?? m.email ?? "this member";
            const canEditThis = !isSelf && manageable.includes(m.role);
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {m.name ?? "—"} {isSelf ? <span className="text-sm font-normal text-muted">(you)</span> : null}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {m.email} · joined {dateFmt.format(new Date(m.joinedAt))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {canEditThis ? (
                    <RoleSelect userId={m.userId} role={m.role} roles={manageable} action={changeMemberRole.bind(null, bid)} />
                  ) : (
                    <Badge tone={m.role === "owner" ? "brand" : "neutral"}>{m.role}</Badge>
                  )}
                  {canEditThis || isSelf ? (
                    <RemoveMember userId={m.userId} label={label} isSelf={isSelf} action={removeMember.bind(null, bid)} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {canManage ? (
        <Card>
          <h2 className="border-b border-border px-6 py-4 text-base font-semibold">Pending invitations</h2>
          {invitations.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-border">
              {invitations.map((inv) => {
                const expired = new Date(inv.expires_at).getTime() <= Date.parse(ent.snapshot.evaluated_at);
                return (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                    <div>
                      <p className="font-medium">{inv.email}</p>
                      <p className="text-sm text-muted">
                        <span className="capitalize">{inv.role}</span> ·{" "}
                        {expired ? "expired" : `expires ${dateFmt.format(new Date(inv.expires_at))}`}
                      </p>
                    </div>
                    {expired ? <Badge tone="warning">Expired</Badge> : null}
                    {inv.role !== "admin" || ent.role === "owner" ? (
                      <RevokeInvitation invitationId={inv.id} email={inv.email} action={revokeInvitation} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
