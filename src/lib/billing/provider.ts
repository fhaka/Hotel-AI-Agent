/**
 * Provider-neutral billing contract. HotelAI's subscription state, webhook
 * idempotency and entitlements never depend on a specific provider; Paddle
 * is one implementation (paddle.ts). Another provider = another adapter.
 */
export type OurSubscriptionStatus = "active" | "past_due" | "paused" | "canceled";

export type NormalizedSubscription = {
  id: string;
  customer_id: string | null;
  status: OurSubscriptionStatus;
  plan_id: string | null;
  interval: "month" | "year" | null;
  period_start: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
  checkout_id: string | null;
};

export type NormalizedBillingEvent = {
  provider: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  subscription: NormalizedSubscription | null;
  relatedSubscriptionId: string | null;
  /** Minimal, non-personal summary stored in webhook_events. */
  summary: Record<string, unknown>;
};

export type CheckoutConfig = {
  provider: "paddle";
  environment: "sandbox" | "production";
  clientToken: string;
  priceId: string;
  checkoutId: string;
  customerEmail: string | null;
  successUrl: string;
};

export interface BillingProvider {
  readonly name: "paddle";
  /** Verifies the signature and returns the normalized event; throws on invalid signatures. */
  parseWebhook(rawBody: string, headers: Headers): Promise<NormalizedBillingEvent>;
  changePlan(subscriptionId: string, priceId: string): Promise<void>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<void>;
  portalUrl(customerId: string, subscriptionId: string | null): Promise<string>;
}

export class BillingNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Billing is not configured: missing ${missing.join(", ")}`);
    this.name = "BillingNotConfiguredError";
  }
}

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super("Invalid webhook signature");
    this.name = "InvalidWebhookSignatureError";
  }
}

/** Signature was valid but the payload could not be understood. */
export class InvalidWebhookPayloadError extends Error {
  constructor(detail: string) {
    super(`Invalid webhook payload: ${detail}`);
    this.name = "InvalidWebhookPayloadError";
  }
}
