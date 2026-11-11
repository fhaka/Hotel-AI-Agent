import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Spinner } from "@/components/ui/spinner";
import { safeRedirectPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage({ searchParams }: PageProps<"/auth/sign-up">) {
  return (
    <AuthCard
      title="Create your account"
      description="Set up AI agents for your business. 7-day free trial, no card required."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/auth/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={<Spinner />}>
        <SignUpContent searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function SignUpContent({ searchParams }: Pick<PageProps<"/auth/sign-up">, "searchParams">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const rawNext = one(params.next);
  const email = one(params.email);
  return (
    <SignUpForm
      next={rawNext ? safeRedirectPath(rawNext, "/onboarding") : undefined}
      email={email && email.length <= 320 ? email : undefined}
    />
  );
}
