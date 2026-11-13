# Backups and restore

## What is backed up

| Data | Where | How |
|---|---|---|
| Database (all business data, auth users) | Supabase | Daily backups on Pro; add **Point-in-Time Recovery** for restore to any second (recommended once paying customers exist) |
| Files in Supabase Storage | Supabase | **Not** included in database backups; HotelAI does not store files yet |
| Billing records | Paddle | Paddle is the merchant of record and keeps invoices |
| Code and migrations | GitHub | Every commit |
| Secrets | Vercel / password manager | Keep a copy of every production secret in a password manager, never in git |

## Extra logical backup (recommended)

Supabase backups live in the same provider account. Once a week, keep an independent copy:
```bash
npx supabase db dump --linked -f backup-schema.sql
```
```bash
npx supabase db dump --linked --data-only -f backup-data.sql
```
Encrypt the files (for example `age` or `gpg`) and store them outside Supabase (for example in a private bucket of
another provider) for 30 days. They contain personal data, so treat them like the database: limited access, deletion
after the retention period.

## Restore drill (do this before launch, then every quarter)

1. Create a temporary Supabase project.
2. Restore the latest backup into it (Supabase dashboard → *Database → Backups → Restore to new project*, or `psql` with
   the dump files).
3. Point a local `npm run dev` at it and sign in as a test user; check that reservations and conversations are there.
4. Write down how long it took (your real recovery time) and delete the temporary project.

## Targets

- **RPO** (data you can lose): 24 h with daily backups; minutes with PITR.
- **RTO** (time to restore): measure it in the drill; aim for under 4 hours.

## After a restore

- Re-run `npx supabase db push --remote` if the restored copy is older than the latest migration.
- Billing:
  - Paddle keeps sending webhooks; replay missed ones from the Paddle dashboard (*Notifications → event log*).
  - `apply_billing_event` is idempotent and ignores stale events.
- Notifications: queued emails resume; the dedupe keys prevent duplicates.

**Status:** these procedures are documented but have **not been rehearsed** yet. They need the production project.
