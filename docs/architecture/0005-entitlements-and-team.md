# ADR 0005 — Entitlement service and team invitations

**Status:** accepted · 2026-11-13

## Entitlements

Two layers:

1. **Facts — `public.get_business_entitlements(business_id)` (SQL).** Verifies the caller is an
   active member via `auth.uid()`, then returns a snapshot: subscription status, trial window,
   whether access is active (evaluated with the **database clock**), the usage period, plan or
   trial limits, plan features, usage in the period (AI messages, tokens, voice minutes, seats incl.
   pending invitations), agents, and the caller's role. A service-role-only twin
   (`get_business_entitlements_service`) exists for trusted server code with no signed-in user
   (public website widget, jobs).
2. **Decisions — `src/lib/entitlements` (TypeScript, pure, unit-tested).**
   `getBusinessEntitlements(businessId, user)` parses the snapshot strictly (unknown shape ⇒ deny)
   and returns capability flags (`canUseAgents`, `canCreateReservations`, `canUseVoice`,
   `canUseAutomation`, `canInviteMembers`, `can(permission)`) plus `agent(type)`, the ordered
   7-point check every agent execution must pass:
   member → role → subscription/trial → usage limits → agent exists/available → enabled → in plan.
   Denials carry stable codes (`trial_expired`, `usage_limit_reached`, …) for consistent UI/API errors.

Access rules by status: `trialing` until `trial_ends_at`; `active`; `past_due` (grace while the
provider retries); `canceled` until `current_period_end`; `paused`/`expired`/`incomplete` none.
Without access: agents, invitations and (later) automations stop; sign-in, viewing data and the
billing page keep working; nothing is deleted.

Seat limits and invitations are enforced in SQL under an advisory lock, so concurrent requests
can't exceed them.

## Team invitations

- `create_business_invitation()` — owners invite admin/manager/staff, admins invite manager/staff,
  nobody invites an owner (promote later). Requires active access and a free seat. Re-inviting the
  same email replaces (revokes) the previous link.
- The token is 32 random bytes, returned **once**; only its SHA-256 is stored, and the hash column
  is not readable by clients.
- `accept_business_invitation(token)` requires a signed-in user whose **verified** email equals
  the invited email. A forwarded link is useless to anyone else. Links are single-use and expire
  after 7 days.
- `get_invitation_preview(token)` lets the landing page show business, role and invited email to
  the token holder (also when signed out).
- Email is sent through Resend with `idempotencyKey = invitation:<id>`, so retries never
  double-send. If email isn't configured or fails, the inviter is told so honestly and gets the
  link to share manually.
- Sign-up from an invitation carries `next=/invite/<token>` through email verification. This
  requires the confirmation template to link via `{{ .RedirectTo }}` (see docs/setup/supabase.md).

## Agent configuration

Owners/admins may change `name`, `description`, `enabled` and `system_configuration` (column grants).
`system_configuration` holds only validated business preferences (tone, greeting, hand-over
message, extra instructions; ≤ 20 KB). The platform's base prompt and safety rules stay in code
(Phase 5), so a business can't remove them. A trigger refuses enabling unavailable agents
(e.g. voice before an integration exists).

## Audit

Generic triggers log updates to agents, businesses, business settings and subscriptions, with the
**names** of changed columns only (no values, no personal data). Invitation lifecycle and member
changes are logged by their functions.
