"use client";

import { initializePaddle } from "@paddle/paddle-js";
import { useActionState, useEffect, useState } from "react";
import type { BillingActionState } from "@/app/dashboard/billing/actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export type PlanCard = {
  id: "basic" | "growth" | "business";
  name: string;
  description: string | null;
  monthlyCents: number;
  annualCents: number;
  currency: string;
  messagesPerMonth: number | null;
  members: number | null;
  features: string[];
  purchasable: { month: boolean; year: boolean };
};

type Action = (s: BillingActionState, fd: FormData) => Promise<BillingActionState>;

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

/**
 * Plan selection. For a new subscription it opens Paddle's checkout overlay
 * with a server-prepared checkout session; the subscription only changes
 * when Paddle's signed webhook arrives. With a live subscription it requests
 * a plan change through the server instead.
 */
export function PlanPicker({
  plans,
  current,
  mode,
  canManage,
  checkoutAction,
  changeAction,
}: {
  plans: PlanCard[];
  current: { planId: string | null; interval: "month" | "year" | null; paid: boolean };
  mode: "checkout" | "change" | "unavailable";
  canManage: boolean;
  checkoutAction: Action;
  changeAction: Action;
}) {
  const [interval, setInterval] = useState<"month" | "year">(current.interval ?? "month");
  const [checkoutState, checkoutDispatch, checkoutPending] = useActionState(checkoutAction, { status: "idle" });
  const [changeState, changeDispatch, changePending] = useActionState(changeAction, { status: "idle" });
  const [overlayError, setOverlayError] = useState<string | null>(null);

  useEffect(() => {
    const cfg = checkoutState.checkout;
    if (checkoutState.status !== "success" || !cfg) return;
    let cancelled = false;
    initializePaddle({ token: cfg.clientToken, environment: cfg.environment })
      .then((paddle) => {
        if (cancelled) return;
        if (!paddle) throw new Error("Paddle.js failed to load");
        paddle.Checkout.open({
          items: [{ priceId: cfg.priceId, quantity: 1 }],
          customData: { checkout_id: cfg.checkoutId },
          ...(cfg.customerEmail ? { customer: { email: cfg.customerEmail } } : {}),
          settings: { displayMode: "overlay", successUrl: cfg.successUrl },
        });
      })
      .catch(() => setOverlayError("The payment window could not be opened. Check your connection or ad blocker and try again."));
    return () => {
      cancelled = true;
    };
  }, [checkoutState]);

  const message = overlayError ?? (checkoutState.status === "error" ? checkoutState.message : changeState.message);
  const tone = overlayError || checkoutState.status === "error" || changeState.status === "error" ? "danger" : "success";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-lg border border-border p-1 text-sm">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={cn("rounded-md px-3 py-1.5", interval === i ? "bg-brand-600 text-white" : "text-muted hover:text-ink")}
            >
              {i === "month" ? "Monthly" : "Annual (2 months free)"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">Payments are processed by Paddle. Taxes are calculated at checkout.</p>
      </div>

      {message ? <Alert tone={tone}>{message}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = current.paid && current.planId === p.id && current.interval === interval;
          const price = interval === "month" ? p.monthlyCents : p.annualCents;
          const available = p.purchasable[interval];
          return (
            <Card key={p.id} className={cn("flex flex-col p-6", isCurrent && "border-brand-600 ring-1 ring-brand-600")}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                {isCurrent ? <Badge tone="brand">Current</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">{p.description}</p>
              <p className="mt-4 text-3xl font-semibold">
                {money(price, p.currency)}
                <span className="text-sm font-normal text-muted">/{interval === "month" ? "month" : "year"}</span>
              </p>
              <ul className="mt-4 flex-1 space-y-1 text-sm">
                {p.messagesPerMonth ? <li>{p.messagesPerMonth.toLocaleString("en")} AI messages / month</li> : null}
                {p.members ? <li>Up to {p.members} team members</li> : null}
                {p.features.map((f) => (
                  <li key={f} className="text-muted">✓ {f}</li>
                ))}
              </ul>
              {canManage && mode !== "unavailable" && !isCurrent ? (
                <form action={mode === "checkout" ? checkoutDispatch : changeDispatch} className="mt-6">
                  <input type="hidden" name="planId" value={p.id} />
                  <input type="hidden" name="interval" value={interval} />
                  <Button type="submit" className="w-full" disabled={!available || checkoutPending || changePending}>
                    {!available ? "Not available online yet" : mode === "checkout" ? `Choose ${p.name}` : `Switch to ${p.name}`}
                  </Button>
                </form>
              ) : null}
            </Card>
          );
        })}
      </div>
      {mode === "change" && canManage ? (
        <p className="text-xs text-muted">Plan changes are prorated immediately by Paddle. They appear here once Paddle confirms them.</p>
      ) : null}
    </div>
  );
}
