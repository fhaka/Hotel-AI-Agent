# ADR 0010 — Automation: notification outbox and scheduled jobs

**Status:** accepted · 2026-11-18

## Decision

- **No workflow engine as source of truth.** HotelAI decides what is due, in SQL, from its own
  data. An external scheduler (Vercel Cron, n8n, cron) only calls `POST /api/jobs/run` with a
  bearer secret, checked in constant time; a secret shorter than 32 characters is rejected.
- **Outbox table `notifications`.** `enqueue_due_notifications()` inserts rows with a unique
  `dedupe_key`, which makes enqueueing idempotent.

  | Kind | Recipient | When | Dedupe |
  |---|---|---|---|
  | `guest_pre_arrival` | guest | check-in = local today + N days (default 2); confirmed; has email; business has access **and** the `automations` feature | per reservation |
  | `owner_trial_ending` | owners | trial ends within 48 h | per business/owner |
  | `owner_trial_ended` | owners | trial ended in the last 7 days, no paid subscription | per business/owner |
  | `owner_payment_failed` | owners | subscription `past_due` | per billing period/owner |
  | `staff_escalation` | alert address, or owners+admins | live (non-playground) hand-over | per conversation/recipient |
  | `staff_unanswered_inquiry` | same | still escalated after N h (default 4) | per conversation/recipient |
  | `owner_daily_report` | owners | once per local day after hour H (default 8), onboarding done, access active | per local date/owner |
  | `owner_welcome` | owners | workspace created in the last day | per business/owner |

- **Delivery.**
  - `claim_notifications()` uses `FOR UPDATE SKIP LOCKED`, so parallel workers never send the
    same row (tested with 4 workers). Rows stuck in `sending` for 15 minutes are reclaimed.
  - The email is rendered **at send time from current data** (`render.ts`). It is skipped if the
    situation changed: booking canceled, hand-over resolved, payment recovered, or already
    subscribed.
  - Resend's idempotency key is `notification:<id>`.
  - `complete_notification()`: `sent`; `retry` with exponential backoff (2^attempts minutes,
    max 6 h, up to 5 attempts, then `failed`); `skipped` (with reason, including email not
    configured).
- **Monitoring.** `job_runs` records each run's stats and errors (30-day retention).
  `automation_health()` feeds the "scheduler healthy / hasn't run" banner, and owners/admins see
  their notification log. Every step of a run is isolated: one failing step yields a `partial`
  run, and the other steps still execute.
- **Settings.** `business_settings.notification_preferences` (reminder days, report hour, alert
  address, unanswered threshold), editable by owners/admins on the Automations page.
- **Hand-overs** are now visible and closable: on `/dashboard/conversations`, any member can call
  `resolve_conversation`, which stops the reminders.
- Trials past their end are marked `expired` by the job. Access already ended at `trial_ends_at`
  through `compute_entitlements`.

## Not included

SMS/WhatsApp notifications (Phase 9), per-guest email unsubscribe for marketing (these are
transactional/service emails), and an operator view of failed jobs across all businesses (Phase 10
admin area).
