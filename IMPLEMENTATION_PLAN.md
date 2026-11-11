# HotelAI — Implementation Plan

Living document. Updated at the end of every phase. Last update: **Phase 5 complete** (2026-11-15).

## Repository status at start

The repository was **empty** (no commits, no files on any remote branch). There was no existing
code to preserve or fix; everything below was built from scratch.

## Technology baseline (verified, not assumed)

| Component | Version | Notes |
|---|---|---|
| Node.js | 22.23 | CI pins Node 22 |
| Next.js | 16.4.6 | App Router, **Cache Components on by default**, `proxy.ts` replaces `middleware.ts` |
| React | 19.3 | |
| Tailwind CSS | 4.3 | CSS-first config via `@theme` in `globals.css` |
| @supabase/ssr | 0.12.7 | `getAll`/`setAll` cookie API, `auth.getClaims()` |
| @supabase/supabase-js | 2.119 | |
| Zod | 4.6 | |
| Vitest | 5.1 | `unit` and `db` projects |
| PostgreSQL | 17 (Supabase) / 16 (local test cluster) | migrations verified on both |

Version-specific APIs were checked against the docs bundled in `node_modules/next/dist/docs` and the
installed Supabase type definitions.

## Architecture decisions

Recorded in [`docs/architecture/`](docs/architecture):

- [0001 — Technology stack](docs/architecture/0001-technology-stack.md)
- [0002 — Multi-tenancy and Row Level Security](docs/architecture/0002-multi-tenancy-and-rls.md)
- [0003 — Trials, subscriptions and entitlements](docs/architecture/0003-trials-and-entitlements.md)
- [0004 — Onboarding wizard and active workspace](docs/architecture/0004-onboarding-and-active-workspace.md)
- [0005 — Entitlement service and team invitations](docs/architecture/0005-entitlements-and-team.md)
- [0006 — Knowledge base and agent knowledge context](docs/architecture/0006-knowledge-base.md)
- [0007 — AI agent runtime and playground](docs/architecture/0007-agent-runtime.md)

## Phases

Legend: ✅ done · 🟡 partially done (groundwork only) · ⬜ not started

### Phase 1 — Foundation ✅

| Item | Status |
|---|---|
| Next.js + TypeScript + Tailwind scaffold, lint, type-check | ✅ |
| Supabase clients: browser, server (per request), proxy, privileged admin (server-only) | ✅ |
| Environment validation (`src/lib/env.ts`, `src/lib/env.server.ts`) and `.env.example` | ✅ |
| Auth: sign-up, email verification, login, logout, forgot/reset password, callback | ✅ |
| Protected routes: `src/proxy.ts` redirect + server-side `requireUser()` re-check | ✅ |
| Open-redirect protection for `?next=` | ✅ |
| Database migrations for **all** core tables (identity, tenancy, billing, hotel, agents) | ✅ |
| RLS on every table, explicit grants, membership helpers, role-change functions | ✅ |
| Database-level double-booking prevention (exclusion constraint) | ✅ |
| Trial integrity at DB level (one trial per user, immutable trial dates, no client writes) | ✅ |
| Atomic `create_business_workspace()` function (business + owner + settings + trial + agents) | ✅ (DB only; UI is Phase 2) |
| Automated tests: 35 unit + 39 database security tests | ✅ |
| CI workflow (lint, types, unit, DB, build) | ✅ |
| Professional homepage, design tokens and shared UI components | ✅ (initial set) |

**Acceptance criteria — "a new user can register, verify their email, log in, and log out":**
implemented and wired to Supabase Auth. Verified automatically: validation, redirects, route
protection, open-redirect defence, and all database behaviour. **Not yet verified end-to-end
against a live Supabase Auth server** — the sandbox this was built in could not download the
Supabase Auth container image (network policy). See "How to verify Phase 1" in the README; this
needs a 10-minute manual check with your Supabase project.

### Phase 2 — Business onboarding ✅

| Item | Status |
|---|---|
| Multi-step wizard: company → operations → hotel & rooms (hotels only) → review | ✅ |
| Workspace + owner + settings + 7-day trial + default agents created atomically at step 1 | ✅ |
| Progress saved per step, resumable (`/onboarding/:id`), every step editable later | ✅ |
| Opening hours, policies, contact instructions, services, FAQs | ✅ |
| Hotel: check-in/out, currency, cancellation/breakfast/parking/Wi-Fi/pets/extras, room types with capacity, beds, amenities, price, room numbers (ranges like `101-110`) | ✅ |
| One transaction per step; owner/admin enforced in the database; progress not client-writable | ✅ |
| Server + database validation with field-level error messages; form input kept on errors | ✅ |
| Multi-workspace support: active workspace (cookie re-validated) and business switcher | ✅ |
| Dashboard shows the active workspace's real plan, trial countdown (business time zone), agents, knowledge and room counts | ✅ |
| Generated database types (`npm run db:types`) + CI drift check | ✅ |
| Seasonal pricing | ⏭ moved to Phase 6 (Rooms page) to keep onboarding short |
| Welcome email | ⏭ moved to Phase 8 (needs Resend + email infrastructure) |

**Acceptance criteria — "a new user can create a business workspace; the workspace, owner
membership, trial and default agents are stored correctly":** verified at the database level
(55 DB tests) including a contract test that sends real form data through the same validation and
argument builders as the Server Actions into the real SQL functions. **Not yet verified by clicking
through the UI against a live Supabase project** (see "Known gaps").

### Phase 3 — SaaS dashboard ✅

| Item | Status |
|---|---|
| Central entitlement service: SQL facts (DB clock) + pure TS decisions, `getBusinessEntitlements()`, 7-point agent execution check with stable error codes | ✅ |
| Workspace layout: sidebar (only real pages), business switcher, trial/usage/payment warning banner | ✅ |
| Overview: plan, trial countdown, AI usage meter, agents, knowledge and room counts | ✅ |
| Plan & usage page: status, trial end in business time zone, usage meters, plan catalogue from the database | ✅ (checkout: Phase 7) |
| Team: members, role changes, remove/leave (confirmation dialogs), seat limits | ✅ |
| Invitations: hashed single-use tokens, verified-email match, 7-day expiry, re-send/revoke, invite landing page, sign-up/verification carries the invite | ✅ |
| Invitation email via Resend (official SDK) with idempotency; honest fallback to a copyable link | ✅ (live sending untested — needs your Resend key) |
| Agent management: list, configure name/description/on-off/tone/greeting/hand-over/instructions; unavailable agents can't be enabled | ✅ |
| Business settings (profile, hours/policies/FAQs, hotel & rooms) reusing the onboarding forms | ✅ |
| Account settings: name, password-change link, sign out | ✅ |
| Audit triggers for agent/business/settings/subscription changes (column names only) | ✅ |

**Acceptance criteria — "a business owner can manage their workspace and see accurate subscription
status":** subscription/usage facts come from one database function evaluated on the database
clock and are covered by DB tests for every status (trial active/expired, active, past_due,
canceled before/after period end, incomplete). UI click-through against live Supabase still pending
(see Known gaps).

### Phase 4 — Knowledge base ✅

| Item | Status |
|---|---|
| `/dashboard/knowledge`: list, category filters with counts, search, pagination, empty states | ✅ |
| Create / edit / delete entries (FAQ, about, services, prices, policies, hours, hotel info, other) with category-specific labels and a confirmation on delete | ✅ |
| Role rules: everyone reads; owner/admin/manager edit (UI + RLS) | ✅ |
| Injection-safe search function (RLS applies, no filter syntax / wildcard interpretation) | ✅ |
| Per-business entry and size limits; author/source can't be spoofed; audit (no content) | ✅ |
| Safe knowledge retrieval for agents: tenant-scoped loader + delimited, budgeted, injection-resistant context builder | ✅ |
| "What your agents know" preview page with budget usage and omission warning | ✅ |
| Prices, policies, operating hours and hotel information | ✅ (structured ones via Business settings, the rest as entries) |
| Document upload (private Storage) | ⏭ deferred: needs text extraction to be useful (see ADR 0006) |

**Acceptance criteria — "a business can enter information and retrieve it only within its own
workspace":** covered by DB tests (RLS on CRUD and search, cross-tenant search and context
loading return nothing) and unit tests (context builder).

### Phase 5 — AI playground ✅

| Item | Status |
|---|---|
| OpenAI Responses API integration (official SDK; stateless, strict function tools, hashed safety identifier, timeouts/retries, error mapping) | ✅ (verified against SDK types; first live call needs your key) |
| Shared agent runtime: entitlements → rate limits → atomic `begin_agent_turn` → knowledge + prompt → tool loop → `complete_agent_turn` / `fail_agent_turn` | ✅ |
| Website receptionist (and reservation assistant without booking tools, which says so honestly) | ✅ |
| Function calling: `search_knowledge`, `request_human_handoff` (Zod-validated, no tenant ids in arguments) | ✅ |
| Conversation and message storage, escalation, retention function | ✅ |
| Usage tracking (messages reserved atomically, tokens recorded, failed turns refunded) | ✅ |
| Trial/plan/usage entitlement checks before every model call (two layers) | ✅ |
| Rate limiting per user and per business | ✅ |
| Prompt-injection defences: fixed rules, delimited data, sanitized preferences/knowledge, canary leak guard, output caps | ✅ |
| `/dashboard/agents/playground`: agent selector, chat, history, new conversation, test-mode status, knowledge summary, usage, errors | ✅ |
| `/api/agent/chat` with same-origin + JSON + size checks | ✅ |
| Streaming responses | ⏭ later (not required for correctness) |
| `/dashboard/conversations` (all channels, for staff) | ⏭ with live channels (Phase 8/9) |

**Acceptance criteria — "a hotel owner can test an actual AI receptionist that responds using that
hotel's saved information":** implemented end-to-end in code and covered piecewise by tests.
**Not yet observed with a real model**: needs `OPENAI_API_KEY`, `OPENAI_MODEL` and
`SUPABASE_SECRET_KEY` on a running deployment.

### Phase 6 — Hotel reservation engine ⬜ (schema 🟡)

- Rooms, room types, seasonal rates, guests, reservations UI.
- Availability search and price calculation as SQL functions (single source of truth).
- `create_reservation` tool: allocation inside a transaction relying on the exclusion constraint.
- Reservation audit history, cancellation rules, confirmation emails, calendar.

### Phase 7 — Billing ⬜ (schema 🟡)

- **First verify** Paddle merchant eligibility for your legal entity/country, payment methods and
  payout options. Do not integrate before this is confirmed.
- Billing-provider abstraction, checkout, signed webhook verification, idempotent processing
  (`webhook_events` unique key already in place), subscription lifecycle, pricing page.

### Phase 8 — Automation ⬜
Resend emails, reminders (trial expiry, bookings), daily reports, n8n integration, retries/monitoring.

### Phase 9 — Voice & channels ⬜
Evaluate Twilio / Vapi / Retell; inbound calls via the same agent runtime; WhatsApp.

### Phase 10 — Production launch ⬜
Nonce-based CSP, security review, error monitoring, backups, performance, legal review (privacy
notice, terms, DPA, retention, call-recording consent), deployment.

## Known gaps and risks (honest list)

1. **No live run against Supabase or OpenAI yet.** The build sandbox could not run
   Supabase Auth/PostgREST (container images blocked by network policy; downloading release
   binaries was not permitted). All flows are covered by unit, render, database and contract
   tests, but the click-through must be checked manually (README) or in CI with a Supabase stack.
2. Trial abuse via *new email addresses* is not prevented (one trial per user account only). Stronger
   signals (verified phone, payment-method fingerprint, domain heuristics) can be added later.
3. Resend invitation emails are implemented against the SDK's types but have not been sent for
   real (no API key here; resend.com docs were also unreachable from this sandbox).
4. Supabase Auth email sending uses Supabase's built-in SMTP by default, which is heavily
   rate-limited — configure custom SMTP (e.g. Resend) before real users sign up.
5. No Content Security Policy yet (baseline security headers are set).
6. `/admin` is protected by login but has no pages yet; platform-admin authorization uses
   `public.platform_admins`, writable only with the service role.
