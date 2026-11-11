import type { ISubscriptionNotificationResponse, ITransactionNotificationResponse } from "@paddle/paddle-node-sdk";
import { planForPriceId, type PriceMap } from "./prices";
import type { NormalizedBillingEvent, OurSubscriptionStatus } from "./provider";

/**
 * Converts a SIGNATURE-VERIFIED Paddle notification (the documented JSON wire
 * format, snake_case) into our provider-neutral shape. Field types come from
 * the official SDK's notification response interfaces, so a breaking change
 * in the SDK's description of the payload fails type-checking.
 *
 * We deliberately do not depend on the SDK's entity classes for parsing: an
 * authentic event with an unexpected shape must be processed or reported as
 * such, never mistaken for a forged signature.
 */
type WireSubscription = Partial<
  Pick<
    ISubscriptionNotificationResponse,
    "id" | "status" | "customer_id" | "canceled_at" | "current_billing_period" | "billing_cycle" | "scheduled_change" | "items" | "custom_data"
  >
>;
type WireTransaction = Partial<Pick<ITransactionNotificationResponse, "subscription_id">>;

export type PaddleWireEvent = { event_id: string; event_type: string; occurred_at: string; data: unknown };

const STATUS: Record<string, OurSubscriptionStatus> = {
  active: "active",
  // HotelAI's trial is internal and card-free; a provider-side trial (if ever
  // configured) has a card on file, so it counts as active.
  trialing: "active",
  past_due: "past_due",
  paused: "paused",
  canceled: "canceled",
};

export function isPaddleWireEvent(value: unknown): value is PaddleWireEvent {
  const v = value as Record<string, unknown> | null;
  return (
    !!v &&
    typeof v.event_id === "string" &&
    v.event_id.length > 0 &&
    v.event_id.length <= 200 &&
    typeof v.event_type === "string" &&
    typeof v.occurred_at === "string" &&
    !Number.isNaN(Date.parse(v.occurred_at))
  );
}

export function normalizePaddleEvent(event: PaddleWireEvent, prices: PriceMap): NormalizedBillingEvent {
  const base = { provider: "paddle", eventId: event.event_id, eventType: event.event_type, occurredAt: event.occurred_at };

  if (event.event_type.startsWith("subscription.")) {
    const s = (event.data ?? {}) as WireSubscription;
    if (typeof s.id !== "string" || !s.id) {
      // Authentic but unusable: recorded as an unresolved event, not applied.
      return { ...base, subscription: null, relatedSubscriptionId: null, summary: { eventType: event.event_type, malformed: true } };
    }
    const priceId = s.items?.[0]?.price?.id ?? null;
    const plan = planForPriceId(prices, priceId);
    const status = STATUS[s.status ?? ""] ?? "canceled";
    const periodEnd = s.current_billing_period?.ends_at ?? (status === "canceled" ? (s.canceled_at ?? event.occurred_at) : null);
    const checkoutId = typeof s.custom_data?.checkout_id === "string" ? s.custom_data.checkout_id : null;
    const cycle = s.billing_cycle?.interval;
    return {
      ...base,
      relatedSubscriptionId: null,
      subscription: {
        id: s.id,
        customer_id: s.customer_id ?? null,
        status,
        plan_id: plan?.planId ?? null, // unknown price -> rejected by the database, never guessed
        interval: plan?.interval ?? (cycle === "year" ? "year" : cycle === "month" ? "month" : null),
        period_start: s.current_billing_period?.starts_at ?? null,
        period_end: periodEnd,
        cancel_at_period_end: s.scheduled_change?.action === "cancel",
        checkout_id: checkoutId,
      },
      summary: { eventType: event.event_type, subscriptionId: s.id, status: s.status ?? null, priceId, knownPrice: Boolean(plan) },
    };
  }

  const related = (event.data as WireTransaction | null)?.subscription_id ?? null;
  return {
    ...base,
    subscription: null,
    relatedSubscriptionId: related,
    summary: { eventType: event.event_type, relatedSubscriptionId: related },
  };
}
