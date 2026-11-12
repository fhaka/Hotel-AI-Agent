import type { Metadata } from "next";
import { deleteWorkspace } from "@/app/dashboard/privacy/actions";
import { DeleteWorkspaceForm } from "@/components/app/delete-workspace-form";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Data & privacy" };

export default async function PrivacyPage() {
  const { workspace } = await getWorkspaceContext("/dashboard/privacy");
  const isOwner = workspace.role === "owner";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data &amp; privacy</h1>
        <p className="mt-1 text-sm text-muted">
          You own the data in {workspace.name}. HotelAI processes guest data on your behalf (see the{" "}
          <a href="/dpa" className="underline">data processing terms</a>).
        </p>
      </div>

      {!isOwner ? <Alert tone="info">Only the workspace owner can export or delete workspace data.</Alert> : null}

      <Card className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">Export all data</h2>
        <p className="text-sm text-muted">
          One JSON file with your business profile, rooms, rates, guests, reservations, knowledge base, agent settings, conversations
          and usage. Use it for backups, moving to another system, or answering a guest&apos;s access request.
        </p>
        {isOwner ? (
          <a href={`/api/workspace/export?business=${workspace.businessId}`} className={buttonClasses("secondary")} download>
            Download export
          </a>
        ) : null}
      </Card>

      <Card className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">Guest requests</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li><strong>Correction:</strong> edit the guest under Guests.</li>
          <li><strong>Erasure:</strong> open the guest and choose &quot;Erase personal data&quot;. Reservations stay for your accounting without personal details.</li>
          <li><strong>Retention:</strong> guest conversations are deleted automatically after the period in the privacy notice.</li>
        </ul>
      </Card>

      {isOwner ? (
        <Card className="space-y-3 border-danger-600/30 p-6">
          <h2 className="text-lg font-semibold text-danger-700">Delete workspace</h2>
          <p className="text-sm text-muted">
            Permanently deletes {workspace.name} with all rooms, reservations, guests, conversations and settings. Team members lose
            access. This cannot be undone — download an export first. An active paid subscription must be canceled first.
          </p>
          <DeleteWorkspaceForm action={deleteWorkspace.bind(null, workspace.businessId)} name={workspace.name} />
        </Card>
      ) : null}
    </div>
  );
}
