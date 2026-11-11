# HotelAI — Implementation Plan

Living document. Updated at the end of every phase. Last update: **Phase 1 complete** (2026-11-11).

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

### Phase 2 — Business onboarding ⬜ (DB groundwork 🟡)

- Multi-step onboarding wizard at `/onboarding` (company → operations → hotel details), saving progress.
- Server action calling `public.create_business_workspace()` (already implemented and tested).
- Hotel-specific details stored in `business_settings` / `agent_knowledge` / `room_types`.
- Active-workspace selection (cookie holding a business id, **always re-validated** against
  membership on the server) and a business switcher.
- Generated database types (`supabase gen types typescript`) replacing hand-written row types.
- Welcome email (requires Resend; Phase 8 infrastructure may be pulled forward).

### Phase 3 — SaaS dashboard ⬜

- Sidebar navigation, business switcher, dashboard overview with real data and empty states.
- Server-side entitlement service `getBusinessEntitlements(businessId, userId)`.
- Trial countdown (displayed in the business time zone), usage display, upgrade screens.
- Team management UI using `update_member_role` / `remove_business_member`; invitations flow.
- Business settings editing.

### Phase 4 — Knowledge base ⬜

- `/dashboard/knowledge` CRUD with categories (table + RLS already exist).
- Private Supabase Storage bucket for documents (later in phase; type/size limits).

### Phase 5 — AI playground ⬜

- OpenAI Responses API integration (model from `OPENAI_MODEL`; verify current docs first).
- Shared agent runtime: entitlement check → load business config/knowledge → tool calling with Zod
  validation → persist conversation → record usage.
- `/dashboard/agents/playground`, `/api/agent/chat`, rate limiting.

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

1. **End-to-end auth not yet run against live Supabase Auth** (see above).
2. Trial abuse via *new email addresses* is not prevented (one trial per user account only). Stronger
   signals (verified phone, payment-method fingerprint, domain heuristics) can be added later.
3. Supabase Auth email sending uses Supabase's built-in SMTP by default, which is heavily
   rate-limited — configure custom SMTP (e.g. Resend) before real users sign up.
4. No Content Security Policy yet (baseline security headers are set).
5. Database row types are hand-written for the few queries that exist; generate types in Phase 2.
6. `/admin` is protected by login but has no pages yet; platform-admin authorization uses
   `public.platform_admins`, writable only with the service role.
