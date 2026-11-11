import "server-only";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { isPaddleWireEvent, normalizePaddleEvent } from "./paddle-normalize";
import { readPriceMap } from "./prices";
import { BillingNotConfiguredError, InvalidWebhookPayloadError, InvalidWebhookSignatureError, type BillingProvider } from "./provider";

/**
 * Paddle Billing adapter (official @paddle/paddle-node-sdk; API verified
 * against the SDK's type definitions and source).
 * Server-only: uses PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET.
 */
export function paddleEnvironment(): "sandbox" | "production" {
  return process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
}

export function createPaddleProvider(): BillingProvider {
  const apiKey = process.env.PADDLE_API_KEY;
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
  const missing = [!apiKey && "PADDLE_API_KEY", !webhookSecret && "PADDLE_WEBHOOK_SECRET"].filter(Boolean) as string[];
  if (missing.length) throw new BillingNotConfiguredError(missing);

  const paddle = new Paddle(apiKey!, {
    environment: paddleEnvironment() === "production" ? Environment.production : Environment.sandbox,
  });

  return {
    name: "paddle",
    async parseWebhook(rawBody, headers) {
      const signature = headers.get("paddle-signature");
      if (!signature) throw new InvalidWebhookSignatureError();
      // 1. Authenticity: HMAC-SHA256 over "ts:body", constant-time compare,
      //    5-second replay window (official SDK).
      let valid = false;
      try {
        valid = await paddle.webhooks.isSignatureValid(rawBody, webhookSecret!, signature);
      } catch {
        valid = false;
      }
      if (!valid) throw new InvalidWebhookSignatureError();
      // 2. Shape: parse the documented wire format ourselves, so an authentic
      //    but unexpected payload is never reported as a forged signature.
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        throw new InvalidWebhookPayloadError("body is not JSON");
      }
      if (!isPaddleWireEvent(json)) throw new InvalidWebhookPayloadError("missing event_id/event_type/occurred_at");
      return normalizePaddleEvent(json, readPriceMap(process.env));
    },
    async changePlan(subscriptionId, priceId) {
      await paddle.subscriptions.update(subscriptionId, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: "prorated_immediately",
      });
    },
    async cancelAtPeriodEnd(subscriptionId) {
      await paddle.subscriptions.cancel(subscriptionId, { effectiveFrom: "next_billing_period" });
    },
    async portalUrl(customerId, subscriptionId) {
      const session = await paddle.customerPortalSessions.create(customerId, subscriptionId ? [subscriptionId] : []);
      return session.urls.general.overview;
    },
  };
}

/** Which billing settings are present (no values). */
export function billingConfigStatus() {
  const prices = readPriceMap(process.env);
  return {
    provider: process.env.BILLING_PROVIDER ?? "paddle",
    serverConfigured: Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_WEBHOOK_SECRET),
    checkoutConfigured: Boolean(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN) && prices.length > 0,
    environment: paddleEnvironment(),
    prices,
  };
}
