import type { Metadata } from "next";
import { Suspense } from "react";
import { signOut } from "@/app/auth/actions";
import { AuthCard } from "@/components/auth/auth-card";
import { Logo } from "@/components/logo";
import { AcceptInvitationForm } from "@/components/team/accept-form";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { acceptInvitation } from "./actions";

export const metadata: Metadata = { title: "Team invitation", robots: { index: false } };

type Preview =
  | { status: "invalid" }
  | { status: "valid" | "expired" | "revoked" | "accepted"; business_name: string; role: string; email: string; expires_at: string };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <main className="w-full max-w-md">
        <Suspense fallback={<Spinner />}>
          <InviteContent params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function InviteContent({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data }, user] = await Promise.all([
    supabase.rpc("get_invitation_preview", { p_token: token }),
    getCurrentUser(),
  ]);
  const preview = (data ?? { status: "invalid" }) as Preview;

  if (preview.status !== "valid") {
    const text = {
      invalid: "This invitation link is not valid. Check that you copied the whole link.",
      expired: "This invitation has expired. Ask the person who invited you to send a new one.",
      revoked: "This invitation was withdrawn. Ask the workspace owner for a new one if needed.",
      accepted: "This invitation has already been used.",
    }[preview.status];
    return (
      <AuthCard title="Invitation unavailable">
        <Alert tone="warning">{text}</Alert>
        <ButtonLink href={user ? "/dashboard" : "/auth/login"} variant="secondary" className="mt-6 w-full">
          {user ? "Go to dashboard" : "Sign in"}
        </ButtonLink>
      </AuthCard>
    );
  }

  const here = `/invite/${token}`;
  const description = `You've been invited to join ${preview.business_name} as ${preview.role}.`;

  if (!user) {
    return (
      <AuthCard title={`Join ${preview.business_name}`} description={description}>
        <p className="text-sm text-muted">
          This invitation is for <strong className="text-ink">{preview.email}</strong>. Sign in or create an account with
          that address to accept.
        </p>
        <div className="mt-6 space-y-3">
          <ButtonLink href={`/auth/login?next=${encodeURIComponent(here)}`} className="w-full">
            Sign in
          </ButtonLink>
          <ButtonLink
            href={`/auth/sign-up?next=${encodeURIComponent(here)}&email=${encodeURIComponent(preview.email)}`}
            variant="secondary"
            className="w-full"
          >
            Create an account
          </ButtonLink>
        </div>
      </AuthCard>
    );
  }

  if ((user.email ?? "").toLowerCase() !== preview.email) {
    return (
      <AuthCard title={`Join ${preview.business_name}`} description={description}>
        <Alert tone="warning">
          You&apos;re signed in as <strong>{user.email}</strong>, but this invitation is for <strong>{preview.email}</strong>.
          Sign out and sign in with the invited address.
        </Alert>
        <form action={signOut} className="mt-6">
          <Button type="submit" variant="secondary" className="w-full">
            Sign out
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Join ${preview.business_name}`} description={description}>
      <AcceptInvitationForm action={acceptInvitation.bind(null, token)} />
    </AuthCard>
  );
}
