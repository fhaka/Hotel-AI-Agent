# ADR 0003 — Trials, subscriptions and entitlements

**Status:** accepted (DB layer) · 2026-11-11

## Trial

- The 7-day trial starts **inside `create_business_workspace()`**, in the same transaction that
  creates the business. Visiting the site or signing up does not start it.
- Trial parameters live in `platform_settings` (`trial.days`, `trial.max_trials_per_user`,
  `trial.plan_id`, `trial.usage_limits`) and can be changed without code changes.
- **One trial per user account**, recorded in `trial_grants`. A second workspace created by the same
  user starts as `incomplete` (needs a paid plan). Concurrent creation is serialized with a
  per-user advisory lock, so parallel requests cannot obtain two trials (tested).
- Clients have **no write privileges** on `subscriptions`, `trial_grants` or `platform_settings`.
  Trial timestamps are additionally immutable via trigger, even for the service role, unless an
  operator sets `hotelai.allow_trial_edit = on` for their session.
- All timestamps are `timestamptz` (UTC). Display uses the business `timezone`.

## Subscription status

`trialing → active` happens **only** from a verified billing webhook processed with the service role
(Phase 7). A redirect from checkout is never treated as proof of payment. `webhook_events` has a
unique `(provider, provider_event_id)` key for idempotency.

## Entitlements (Phase 3/5)

A server-only `getBusinessEntitlements(businessId, userId)` will combine: verified identity,
active membership + role, subscription status, `trial_ends_at` compared with the **database clock**,
plan limits vs. `usage_events` for the current period, and agent `enabled` flags. Every agent
execution calls it before doing any work. After expiry: agents stop, login and read access remain,
billing stays reachable, and no data is deleted.
