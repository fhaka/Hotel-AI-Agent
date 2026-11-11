# ADR 0001 — Technology stack

**Status:** accepted · 2026-11-11

## Decision

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4** for the web app and server logic.
- **Supabase** (PostgreSQL, Auth, Storage) as the system of record.
- **OpenAI Responses API** for agents (Phase 5), **Resend** for email, **Paddle** as the first
  billing provider *subject to eligibility verification*, behind a provider abstraction.
- **n8n** only for orchestration of non-critical workflows; never the source of truth.
- **Vitest** for unit and database tests; Playwright for browser end-to-end tests later.

## Notable version-specific choices

- **Cache Components is enabled** (the Next.js 16 default). Consequences:
  - Anything that reads cookies/session renders inside `<Suspense>` (or a `loading.tsx`).
  - Tenant data is **never** placed in a shared `"use cache"` scope. Cache keys are stored in
    plain text and a mistake there could leak data across tenants. Public, non-tenant data
    (e.g. the marketing page) may be cached.
- **`src/proxy.ts`** (formerly `middleware.ts`) refreshes the Supabase session and performs coarse
  redirects. It is *not* the security boundary.
- **`supabase.auth.getClaims()`** is used to identify the user on the server. It validates the JWT
  signature rather than trusting cookie contents.
- New Supabase API keys: `sb_publishable_…` (browser) and `sb_secret_…` (server only).

## Defence in depth for authorization

1. Proxy redirect (convenience/UX only).
2. Server-side `requireUser()` / membership checks in every page, action and route handler.
3. PostgreSQL Row Level Security + constraints (final authority, also protects against bugs).
