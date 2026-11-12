# ADR 0012 — Production readiness: CSP, operator area, privacy, monitoring

**Status:** accepted · 2026-11-12

## 1. Content Security Policy with nonces

`src/proxy.ts` builds a CSP for every page request (`src/lib/security/csp.ts`):

- `script-src 'self' 'nonce-…' 'sha256-…' https://cdn.paddle.com`, with no `'unsafe-inline'` and no `'unsafe-eval'` in
  production.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- `frame-ancestors 'none'`. The chat widget is the exception: it allows the business's listed websites.
- `connect-src` allows only our own origin, the Supabase project and Paddle.

**Why not `'strict-dynamic'`:** with Cache Components, Next.js prerenders a static page shell at build time. That shell
references our script files without a nonce (there is no request at build time). Allowing same-origin files (`'self'`)
keeps them working. Inline scripts still need this request's nonce.

**Request-time hole:** the root layout contains a `<Suspense>` with a component that awaits `connection()` and renders
nothing. This turns every route into a partial prerender, so the page data scripts are streamed at request time, where
Next.js adds the nonce. Fully static pages would bake those scripts into HTML without a nonce, and the CSP would block
them.

**React's paint-timing snippet** in the static shell is allowed by its SHA-256 hash.

**Guard against regressions:** `npm run check:csp <url>` loads the public pages from a running server and fails if any
script is not allowed by that page's own header. It runs in CI after the build. It was also verified in Chromium: no
violations, and pages hydrate.

**Trade-offs:**
- `style-src` allows `'unsafe-inline'`. React `style` attributes and the Paddle overlay need it, and injected styles
  cannot run code.
- Any same-origin script file is allowed. We serve no user uploads from our origin.

## 2. Operator area (`/admin`)

- Authorization lives in the database. Every `admin_*` function calls `private.require_platform_admin()`, which checks
  `platform_admins`. That table can only be written with the service role or SQL; this is tested.
- The pages use the signed-in user's client, not the service key. Non-admins get a 404.
- Every change is written to `audit_logs` with the operator as actor.

Capabilities:
- **Overview:** businesses, subscription states, an MRR estimate, usage, recorded AI cost, job, notification and webhook
  health, recent billing events and activity, and launch readiness.
- **Businesses:** search and filter, detail view, suspension, per-business limit overrides, and phone/WhatsApp number
  assignment and release.
- **Plans:** limits, features and whether a plan is offered. Prices stay in Paddle.
- **Settings:** trial, platform-wide agent availability, retention and the per-person workspace limit.

**Suspension, limit overrides and agent availability** are applied inside `private.compute_entitlements()` (v3).
Every existing check — agent turns, channels, AI bookings, automations and the UI — already goes through that function,
so none of the call sites needed changes.

## 3. Privacy

- **Data export** (`export_business_data`, owner only): one JSON file. Secrets are left out (provider customer ids,
  widget keys, hashed visitor references).
- **Guest erasure** (`erase_guest`, owner/admin): personal fields are removed. The reservation rows stay for
  accounting.
- **Workspace deletion** (`delete_business`, owner only):
  - The owner must type the workspace name.
  - It is refused while a paid subscription would keep billing.
  - It cascades to all workspace data.
  - `trial_grants` now survive deletion (`on delete set null`); otherwise deleting a workspace would hand out a new trial.
  - `audit_logs` lose their foreign key, so the immutable log outlives the workspace.
- **Retention:** `purge_operational_data()` runs in the scheduled job (notifications, job runs, webhook payloads, audit
  logs, expired quotes) next to the existing conversation purge. Its periods are configurable in `/admin/settings`.
- **Phone disclosure:** callers hear that the call is transcribed but not recorded (call-recording consent).

## 4. Monitoring

- `src/instrumentation.ts` `onRequestError` turns every server error (render, route, action, proxy) into one JSON log
  line and optionally posts it to `ERROR_WEBHOOK_URL` (https only, at most 10 per minute per instance, 3 s timeout,
  never throws). Query strings are dropped and token-like path segments redacted.
- This was verified with a temporary failing route in a production build.
- `/api/health` returns 200 or 503 depending on whether the database answers through the public API, and reveals no
  configuration.
- No third-party error SDK was added. The log lines and webhook work with any host or alerting tool, and Sentry can be
  added later through `instrumentation.ts`.

## 5. Production configuration

`src/lib/launch/readiness.ts` lists every required production setting. `npm run check:env` and the admin overview
report whether each one is present, never its value.
