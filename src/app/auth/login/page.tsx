import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { safeRedirectPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, { tone: "success" | "info"; text: string }> = {
  "signed-out": { tone: "info", text: "You have been signed out." },
};

const ERRORS: Record<string, string> = {
  "link-invalid":
    "That link is invalid or has expired. Links can only be used once — request a new one if needed.",
};

export default function LoginPage({ searchParams }: PageProps<"/auth/login">) {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to manage your workspace and AI agents."
      footer={
        <>
          New to HotelAI?{" "}
          <Link href="/auth/sign-up" className="font-medium text-brand-600 hover:text-brand-700">
            Start your free trial
          </Link>
        </>
      }
    >
      <Suspense fallback={<Spinner />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/auth/login">, "searchParams">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const notice = NOTICES[one(params.notice) ?? ""];
  const error = ERRORS[one(params.error) ?? ""];
  const rawNext = one(params.next);
  const next = rawNext ? safeRedirectPath(rawNext) : undefined;

  return (
    <div className="space-y-4">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <LoginForm next={next} />
    </div>
  );
}
