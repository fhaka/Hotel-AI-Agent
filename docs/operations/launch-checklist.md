# Launch checklist

Tick every line before inviting paying customers. Items marked **(you)** need the owner's accounts or decisions.

## Legal & business (you)
- [ ] Company registered; name and address in `NEXT_PUBLIC_COMPANY_*`.
- [ ] Privacy Notice, Terms and DPA reviewed by a lawyer for your country and your customers' countries (EU/UK GDPR,
      Albania Law 124/2024); then set `NEXT_PUBLIC_LEGAL_REVIEWED=true`.
- [ ] Sub-processor list matches the services you actually use (`src/lib/legal.ts`).
- [ ] Data processing agreements accepted with Supabase, OpenAI, Resend, Twilio and Vercel (most are accepted in their
      dashboards).
- [ ] Paddle seller account approved for your entity and website; payout bank account verified.

## Production configuration
- [ ] Supabase production project (EU region, Pro), migrations pushed, custom SMTP, redirect URLs.
- [ ] All environment variables set; `/admin` → *Launch readiness* all green (or `npm run check:env`).
- [ ] Paddle live: products and prices created, price IDs set, webhook destination created, domain approved.
- [ ] Resend domain verified (SPF, DKIM, DMARC).
- [ ] Scheduler calling `/api/jobs/run` every 5 minutes; `/admin` shows recent runs.
- [ ] Uptime monitor on `/api/health`; `ERROR_WEBHOOK_URL` set and tested.
- [ ] First platform admin created; admin password stored in a password manager.

## Verification on production
- [ ] CI green on the deployed commit.
- [ ] Smoke test from `docs/setup/deployment.md` passed.
- [ ] Real purchase + refund in Paddle live.
- [ ] Real phone call and WhatsApp message (if offered) — see `docs/setup/channels.md`.
- [ ] Backup restore drill done (`docs/operations/backups.md`).
- [ ] Native-speaker review of the built-in phone phrases for the languages you sell in.

## Customer readiness
- [ ] Support email monitored; reply template for "how do I…" questions.
- [ ] Customer onboarding process (`docs/operations/customer-onboarding.md`) rehearsed with one friendly hotel.
