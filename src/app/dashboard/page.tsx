import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { listMyWorkspaces } from "@/lib/workspaces/queries";

export const metadata: Metadata = { title: "Dashboard" };

const ROLE_LABEL = { owner: "Owner", admin: "Admin", manager: "Manager", staff: "Staff" } as const;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  // Re-verify identity on the server; the proxy redirect is only a convenience.
  const user = await requireUser("/dashboard");
  const [workspaces, params] = await Promise.all([listMyWorkspaces(user), searchParams]);

  return (
    <div className="space-y-6">
      {params.notice === "password-updated" ? <Alert tone="success">Your password has been updated.</Alert> : null}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your workspaces</h1>
        <p className="mt-1 text-sm text-muted">Each business has its own private workspace, agents and data.</p>
      </div>

      {workspaces.length === 0 ? (
        <Card className="p-10 text-center">
          <h2 className="text-lg font-semibold">Create your first business workspace</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Tell us about your business to set up your AI agents. Your 7-day free trial starts when the
            workspace is created — no payment card required.
          </p>
          <ButtonLink href="/onboarding" className="mt-6">
            Set up workspace
          </ButtonLink>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((w) => (
            <li key={w.businessId}>
              <Card className="p-5">
                <p className="font-medium">{w.name}</p>
                <p className="mt-1 text-sm capitalize text-muted">
                  {w.industry.replace("_", " ")} · {ROLE_LABEL[w.role]}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
