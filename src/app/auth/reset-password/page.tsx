import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password">
      <Suspense fallback={<Spinner />}>
        <ResetPasswordContent />
      </Suspense>
    </AuthCard>
  );
}

async function ResetPasswordContent() {
  // The recovery link signs the user in with a short-lived session. Without
  // it, there is nothing to reset.
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Alert tone="warning" title="Reset link required">
        Open the link from your password reset email to continue, or{" "}
        <Link href="/auth/forgot-password" className="font-medium underline">
          request a new link
        </Link>
        .
      </Alert>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Setting a new password for {user.email ?? "your account"}.</p>
      <ResetPasswordForm />
    </div>
  );
}
