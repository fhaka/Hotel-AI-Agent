import "server-only";
import { NextResponse } from "next/server";
import { createPaddleProvider } from "./paddle";
import { BillingNotConfiguredError, InvalidWebhookPayloadError, InvalidWebhookSignatureError, type BillingProvider } from "./provider";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Handler for POST /api/billing/webhook — Paddle notifications.
 *
 * Authentication is the cryptographic signature (Paddle-Signature header),
 * not a session; this path is excluded from the auth proxy. Only verified
 * events reach the database, where apply_billing_event() applies them
 * idempotently and in order. Responses:
 *   401 invalid/missing signature (nothing is processed)
 *   400 authentic signature but unusable payload
 *   503 billing not configured
 *   500 database error (the provider retries; processing is idempotent)
 *   200 everything else (including events we record but don't act on)
 */
const MAX_BODY = 1_000_000;

export async function handleBillingWebhook(
  request: Request,
  deps: { provider?: () => BillingProvider; admin?: () => ReturnType<typeof createAdminClient> } = {},
) {
  let provider: BillingProvider;
  try {
    provider = (deps.provider ?? createPaddleProvider)();
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
    throw err;
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  let event;
  try {
    event = await provider.parseWebhook(raw, request.headers);
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) {
      console.warn("[billing] rejected webhook with invalid signature");
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
    if (err instanceof InvalidWebhookPayloadError) {
      // Authentic sender, unusable body: tell the provider (400) and log loudly.
      console.error("[billing] authentic webhook with invalid payload", { message: err.message });
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }
    console.error("[billing] webhook parse failed", { name: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const admin = (deps.admin ?? createAdminClient)();
  const { data, error } = await admin.rpc("apply_billing_event", {
    p_provider: event.provider,
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_occurred_at: event.occurredAt,
    p_subscription: event.subscription as never,
    p_related_subscription_id: event.relatedSubscriptionId as string,
    p_payload: event.summary as never,
  });
  if (error) {
    console.error("[billing] apply_billing_event failed", { code: error.code, eventType: event.eventType });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  const result = (data as { result?: string })?.result ?? "unknown";
  if (result === "unresolved" || result === "invalid" || result === "conflict") {
    // Acknowledge (retrying won't help) but leave a trace for the operator.
    console.error("[billing] webhook needs attention", { result, eventType: event.eventType, eventId: event.eventId });
  }
  return NextResponse.json({ received: true, result });
}
