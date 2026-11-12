# Performance review — November 2026

## Rendering

- All pages are partial prerenders: a static shell plus request-time content.
  - The request-time part is required for the CSP nonce (ADR 0012).
  - Public pages still serve their static HTML shell immediately.
- Session-dependent parts stream behind `<Suspense>`/`loading.tsx`, so navigation never waits on background work.
- Long-running work (emails, retention, reminders) runs in the scheduled job, not in requests. AI calls have timeouts:
  60 s for chat, about 11 s for phone and 12 s for WhatsApp.

## Database

- **Indexes** exist for every tenant-scoped list and lookup:
  - reservations by business and dates, status or guest;
  - guests by email and name;
  - conversations, messages and usage by business and time;
  - notifications by status and due time.
- Pages and admin lists are paginated (operator list: 50 per page; capped in SQL at 200).
- **Measured:** `compute_entitlements` runs on every AI message and on many pages.
  - It took **≈ 42 ms with 300,000 usage events** for one business in the current period (PostgreSQL 16, local).
  - That load is about 5× the Business plan's monthly message allowance including token events.
  - Typical businesses will be well under 10 ms.
  - **Follow-up when a business exceeds ~1M usage rows per period:** a daily usage rollup table maintained in
    `complete_agent_turn`.
- AI turns are serialized per business (advisory lock) so limits are exact. One business's throughput is therefore one
  turn-start at a time. Turn start takes milliseconds; the model call happens outside the lock.
- The scheduled job evaluates entitlements only for rows that already match date filters (for example, check-in
  exactly N days ahead).

## External services

- OpenAI: `store: false`, at most 4 tool rounds per turn, timeouts, and a clean failure that releases reserved usage.
- Email: idempotency keys, retries with backoff (5 attempts), batch limits per run.
- Paddle and Twilio webhooks do bounded work and answer quickly.

## Not yet measured

- Load tests against the production stack: concurrent widget chats and phone calls.
- Cold starts on the chosen host.

Do these after deployment with a tool such as k6, using the playground or a test widget so that real customers aren't
billed.
