import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");

  return (
    <Card className="space-y-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to HotelAI</h1>
      <p className="text-sm text-muted">
        Your account ({user.email}) is verified and signed in.
      </p>
      <Alert tone="info" title="Workspace setup is the next build phase">
        The step-by-step onboarding wizard (business details, hotel information, trial start and default
        agents) is implemented in Phase 2. The secure database function it will call already exists and is
        covered by automated tests, but there is intentionally no button here until the full flow is built.
      </Alert>
      <ButtonLink href="/dashboard" variant="secondary">
        Go to dashboard
      </ButtonLink>
    </Card>
  );
}
