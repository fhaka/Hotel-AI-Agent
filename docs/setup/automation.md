# Scheduled jobs (Phase 8)

All automation logic lives in HotelAI: which emails are due, de-duplication, retries and
retention. A scheduler only calls one secured endpoint, every 5–15 minutes:

```
POST /api/jobs/run      (GET also accepted)
Authorization: Bearer <CRON_SECRET>
```

Each run:
1. marks ended trials as expired;
2. queues due notifications (each one at most once, via a unique key);
3. sends queued emails in batches (concurrency-safe, with retries and backoff);
4. deletes conversations past their retention period;
5. records the run (the Automations page shows the scheduler's health).

Running it more often, or from two schedulers at once, is safe.

## 1. Configure the server

- `CRON_SECRET`: at least 32 random characters, for example from `openssl rand -hex 32`.
- `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`: required. Without email settings,
  notifications are marked *skipped*, not sent.

## 2. Pick one scheduler

**Vercel Cron.** Add a `vercel.json`. Vercel sends `Authorization: Bearer $CRON_SECRET`
automatically when `CRON_SECRET` is set. How often crons may run depends on your Vercel plan.
```json
{ "crons": [{ "path": "/api/jobs/run", "schedule": "*/10 * * * *" }] }
```

**n8n.** Import `automation/n8n/hotelai-scheduled-jobs.json`. Set the `HOTELAI_URL` environment
variable (or edit the URL) and create a *Header Auth* credential named `Authorization` with the
value `Bearer <CRON_SECRET>`.
- The template was written without access to n8n's documentation from the build environment.
  Check the node versions after importing.
- n8n only triggers the run. Reservations, subscriptions and permissions stay in HotelAI.

**Any server with cron:**
```
*/10 * * * * curl -fsS -X POST https://your-domain/api/jobs/run -H "Authorization: Bearer $CRON_SECRET" > /dev/null
```

## 3. Verify

Open **Automations** in the dashboard. It shows "Scheduler healthy" and recent emails with
their status: sent, skipped (with the reason), or failed after 5 attempts.
