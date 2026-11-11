import type { Metadata } from "next";
import Link from "next/link";
import { completeOnboarding } from "@/app/onboarding/actions";
import { FinishForm } from "@/components/onboarding/finish-form";
import { StepShell } from "@/components/onboarding/step-shell";
import { formatCents } from "@/lib/onboarding/parsing";
import { INDUSTRIES, LANGUAGES } from "@/lib/onboarding/reference-data";
import { STEP_LABELS, stepPath, stepsFor } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Review your setup" };

export default function ReviewStepPage({ params }: PageProps<"/onboarding/[businessId]/review">) {
  return (
    <StepShell params={params} step="review" title="Review your setup">
      {(ctx) => {
        const b = ctx.business;
        const required = stepsFor(b.industry).filter((s) => s !== "review");
        const missing = required.filter((s) => !ctx.completedSteps.includes(s));
        const languages = b.supported_languages.map((c) => LANGUAGES.find((l) => l.code === c)?.label ?? c).join(", ");
        const totalRooms = ctx.roomTypes.reduce((n, rt) => n + rt.roomNumbers.length, 0);
        const backStep = required[required.length - 1];

        return (
          <div className="space-y-6">
            <dl className="divide-y divide-border rounded-lg border border-border text-sm">
              <Row label="Business" value={`${b.name} · ${INDUSTRIES.find((i) => i.value === b.industry)?.label}`} edit={stepPath(b.id, "company")} />
              <Row label="Location" value={[b.address, b.city, b.country].filter(Boolean).join(", ") || "—"} edit={stepPath(b.id, "company")} />
              <Row label="Time zone" value={b.timezone} edit={stepPath(b.id, "company")} />
              <Row label="Languages" value={languages} edit={stepPath(b.id, "company")} />
              <Row
                label="Knowledge"
                value={`${ctx.services.length} service${ctx.services.length === 1 ? "" : "s"}, ${ctx.faqs.length} FAQ${ctx.faqs.length === 1 ? "" : "s"}`}
                edit={stepPath(b.id, "operations")}
              />
              {b.industry === "hotel" ? (
                <Row
                  label="Rooms"
                  value={
                    ctx.roomTypes.length
                      ? `${totalRooms} room${totalRooms === 1 ? "" : "s"} in ${ctx.roomTypes.length} type${ctx.roomTypes.length === 1 ? "" : "s"} · from ${formatCents(
                          Math.min(...ctx.roomTypes.map((rt) => rt.base_price_cents)),
                          ctx.roomTypes[0].currency,
                        )}/night`
                      : "No rooms yet"
                  }
                  edit={stepPath(b.id, "hotel")}
                />
              ) : null}
            </dl>

            {missing.length ? (
              <ul className="space-y-2 text-sm">
                {missing.map((s) => (
                  <li key={s} className="flex items-center justify-between rounded-lg bg-warning-50 px-4 py-2 text-warning-700">
                    <span>Missing: {STEP_LABELS[s]}</span>
                    <Link href={stepPath(b.id, s)} className="font-medium underline">
                      Complete now
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <FinishForm
              action={completeOnboarding.bind(null, b.id)}
              backHref={stepPath(b.id, backStep)}
              ready={missing.length === 0}
              alreadyCompleted={b.onboarding_completed_at !== null}
            />
          </div>
        );
      }}
    </StepShell>
  );
}

function Row({ label, value, edit }: { label: string; value: string; edit: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="w-28 shrink-0 text-muted">{label}</dt>
      <dd className="flex-1">{value}</dd>
      <Link href={edit} className="text-brand-600 hover:text-brand-700">
        Edit
      </Link>
    </div>
  );
}
