import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getOnboardingContext } from "@/lib/onboarding/queries";
import { resumeStep, stepPath } from "@/lib/onboarding/steps";

/** /onboarding/:id -> the first unfinished step. */
export default async function ResumeOnboardingPage({ params }: PageProps<"/onboarding/[businessId]">) {
  const { businessId } = await params;
  const user = await requireUser(`/onboarding/${businessId}`);
  const ctx = await getOnboardingContext(user, businessId);
  if (ctx.access === "denied") redirect("/dashboard");
  redirect(stepPath(businessId, resumeStep(ctx.business.industry, ctx.completedSteps)));
}
