# Deploying HotelAI to production

This guide uses **Vercel** (Next.js host) and **Supabase** (database and auth). Any Node.js 22 host that runs
`next build && next start` works; replace the Vercel steps accordingly. Allow about half a day the first time.

## 1. Supabase production project

1. Create a new project (not the development one) in an **EU region** if your customers are in Europe, on the **Pro**
   plan (daily backups; see `docs/operations/backups.md`).
2. Apply the schema from your machine:
   ```bash
   npx supabase link --project-ref <prod-ref>
   ```
   ```bash
   npx supabase db push --remote
   ```
3. **Authentication:**
   - Under *URL configuration*, set the Site URL to `https://app.yourdomain.com` and add
     `https://app.yourdomain.com/auth/callback` to the redirect URLs.
   - Under *SMTP*, turn on **custom SMTP** with Resend (`smtp.resend.com`, port 465, user `resend`, password = a Resend
     API key). The built-in sender is rate-limited and not meant for production.
   - Under *Email templates*, paste the templates from `supabase/templates/`.
   - Turn on *leaked password protection* (Pro) if available.
4. Copy the URL, the publishable key and a **secret key** (Project settings → API keys).

## 2. Vercel project

1. Import the GitHub repository and choose the Next.js preset.
2. Add the environment variables for **Production**. Fill in every variable in `.env.example`. Notes:
   - `NEXT_PUBLIC_APP_URL=https://app.yourdomain.com`
   - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
   - OpenAI: `OPENAI_API_KEY` and `OPENAI_MODEL`. Choose a fast model if you use phone calls.
   - Resend: `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, on a verified domain.
   - Paddle: the live keys, `PADDLE_ENVIRONMENT=production`, and the six live price IDs.
   - `CRON_SECRET`: generate it with `openssl rand -hex 32`.
   - `TWILIO_AUTH_TOKEN`, only if you offer phone or WhatsApp.
   - Legal: `NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_COMPANY_ADDRESS`, `NEXT_PUBLIC_SUPPORT_EMAIL`, and later
     `NEXT_PUBLIC_LEGAL_REVIEWED=true`.
   - Optional: `ERROR_WEBHOOK_URL`, an HTTPS endpoint for error alerts (for example a Slack incoming webhook).
3. **Never** put secrets in variables starting with `NEXT_PUBLIC_`; those are visible in the browser.
4. Add the domain `app.yourdomain.com` and deploy.
5. Check the configuration locally with the same values (they are read from the file, never printed):
   ```bash
   node --env-file=.env.production scripts/check-env.ts
   ```

## 3. Connect the services to the deployed URL

- **Paddle (live):**
  - Approve your domain (Paddle requires website approval before live checkout).
  - Create the notification destination `https://app.yourdomain.com/api/billing/webhook` and copy its secret to
    `PADDLE_WEBHOOK_SECRET`.
  - Set the default payment link to your domain. Details: `docs/setup/paddle.md`.
- **Scheduler:**
  - Every 5 minutes, call `POST https://app.yourdomain.com/api/jobs/run` with `Authorization: Bearer $CRON_SECRET`.
  - Vercel Cron can do this on Pro (Hobby only allows daily runs); otherwise use n8n or any cron service. See
    `docs/setup/automation.md`.
- **Twilio** (optional): webhook URLs from `docs/setup/channels.md`.
- **Uptime monitor:** check `https://app.yourdomain.com/api/health` every minute and alert on anything that isn't 200.

## 4. First operator account

Sign up in the app like a customer and verify the email, then in the Supabase SQL editor:
```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'you@yourcompany.com';
```
Open `/admin`. The **Launch readiness** card must be all green.

## 5. Smoke test after every deployment

1. `/`, `/pricing`, `/privacy` load; browser console shows no CSP errors.
2. Sign up with a new address → verification email arrives → workspace + trial created.
3. Playground answers; knowledge preview correct.
4. `/admin` overview shows a recent scheduler run (≤ 10 minutes).
5. `/api/health` returns `{"status":"ok"}`.
6. (Live billing) Buy the cheapest plan with a real card, then refund it in Paddle. The subscription becomes *Active*,
   then *Canceled*.

## Rolling back

- Vercel: *Deployments → Promote* the previous deployment.
- Database migrations are forward-only. Write a new migration to undo a change, and restore from backup only for data
  loss.
