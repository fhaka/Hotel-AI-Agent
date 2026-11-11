# ADR 0009 — Billing: provider abstraction, Paddle, verified webhooks

**Status:** accepted (code) · **Paddle eligibility for the legal entity: NOT yet verified** · 2026-11-17

## Decision

- **Provider-neutral core:** subscription state, idempotency, history and entitlements live in our
  database and don't depend on the provider.
- **Paddle is one adapter** (`src/lib/billing/paddle.ts`) behind `BillingProvider`. Another
  provider means another adapter plus a value in `billing_checkout_sessions.provider`.
- **API verification:** Paddle's docs were unreachable from the build environment. The API was
  verified against the official SDKs `@paddle/paddle-node-sdk` 3.11 (server) and
  `@paddle/paddle-js` 1.6 (browser), including the SDK's signature-verification source.
- **Eligibility before launch:** the owner must confirm with Paddle that the legal entity,
  country, payout bank and payment methods are supported.

## Trust model

| Step | Trusted? | Why |
|---|---|---|
| Browser checkout (Paddle.js overlay) | No | Runs on the client; `customData` can be tampered with |
| Redirect to `?checkout=processing` | No | Only shows "payment is being confirmed" |
| Webhook with a valid `Paddle-Signature` | Yes | HMAC-SHA256 over `ts:body` with the notification secret, constant-time compare, 5 s replay window |

- **Business resolution:** the business is never read from the payload. An owner-only server
  action creates a `billing_checkout_sessions` row, and only its random id goes to Paddle as
  `customData.checkout_id`. The webhook resolves the business from that row, or from an already
  known `provider_subscription_id`. A forged or foreign id resolves to nothing (tested).
- **Parsing:** the SDK is used only for signature verification. The documented snake_case wire
  format is parsed by `paddle-normalize.ts`, typed against the SDK's own
  `I*NotificationResponse` interfaces.

  Found during testing: using the SDK's `unmarshal` (verify + build entities) turned
  authentic-but-unexpected payloads into "invalid signature". These are now reported as 400 and
  logged as authentic.

## apply_billing_event (service role only)

1. **Idempotency:** the `webhook_events (provider, provider_event_id)` ledger turns duplicates
   into no-ops, and failed or received events can be retried.
2. **Resolve the business**, as above.
3. **Payments and refunds** (`transaction.*`, `adjustment.*`): recorded in `subscription_events`.
   The status follows from the related `subscription.*` events.
4. **Validation:** an unknown price/plan, or `trialing` coming from the provider, is rejected and
   never guessed. Paddle `trialing` maps to `active` because our own trial is internal and
   card-free.
5. **Ordering:** an event older than `provider_updated_at` is recorded as `stale` and not applied.
6. **Conflicts:** a provider subscription id already attached to another business, or a second
   live subscription for the same business, is recorded as `conflict` for manual review. Neither
   is applied.
7. **Apply:** set plan, interval, status, billing period and `cancel_at_period_end`. Trial dates
   remain untouched (their trigger protects them).

Webhook responses:
- 401: bad or missing signature (nothing is processed);
- 400: authentic but unusable payload;
- 503: billing not configured;
- 500: database error (the provider retries; processing is idempotent);
- 200: everything else.

## Lifecycle → access

These follow from `compute_entitlements` (ADR 0003): `active` and `past_due` have access (grace
while Paddle retries); `canceled` has access until `current_period_end`; `paused`/`expired` have
none. Cancellation is requested at the period end (`effectiveFrom: next_billing_period`). Plan
changes use `prorated_immediately`. All changes take effect only when the webhook arrives.

## Not stored

No card data and no raw provider payloads: `webhook_events.payload` holds a minimal summary
(event type, ids, status, price id).

## Open items before production

Paddle eligibility check, live sandbox test (`npm run dev` + Paddle sandbox + webhook tunnel),
production price IDs, invoices via Paddle's customer portal, dunning emails (Phase 8), and an
admin view for `conflict`/`unresolved` webhooks (Phase 10 admin area).
