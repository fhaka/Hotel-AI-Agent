# HotelAI

Multi-tenant SaaS that gives hotels (and later other service businesses) AI receptionists and
reservation assistants, with self-service sign-up, private workspaces, a 7-day free trial and
recurring subscriptions.

> **Status:** Phase 1 (foundation) complete. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
> for what exists, what does not yet, and the roadmap.

## Quick start

Requirements: Node.js 22+, a Supabase project (see [docs/setup/supabase.md](docs/setup/supabase.md)).

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values
npx supabase link --project-ref <your-project-ref>
npx supabase db push         # applies supabase/migrations
npm run dev                  # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (no network, no database) |
| `npm run test:db` | Database security tests: spins up a throwaway PostgreSQL 15+ cluster, applies all migrations, tests RLS, roles, trials and double-booking. Needs PostgreSQL server binaries installed locally (or set `DATABASE_URL_TEST` to an empty disposable database). |

## How to verify Phase 1 manually

1. `npm run dev`, open <http://localhost:3000>, click **Start free trial**.
2. Register → you see "Check your inbox". Trying to sign in before verifying shows
   "Please verify your email address first" with a *Resend* option.
3. Open the verification email → you land on `/onboarding`, signed in.
4. Visit `/dashboard` → "Create your first business workspace" empty state.
5. **Sign out** → redirected to `/auth/login`; visiting `/dashboard` now redirects to login.
6. **Forgot password** → email → link opens `/auth/reset-password` → set a new password → dashboard.

## Project layout

```
src/
  app/                 routes (App Router)
    auth/              sign-up, login, callback, forgot/reset password, server actions
    dashboard/         protected workspace area
    onboarding/        protected; wizard arrives in Phase 2
  components/          shared UI (ui/, auth/, app/)
  lib/
    auth/              session DAL, redirect safety, validation schemas
    supabase/          browser / server / proxy / admin clients
    env.ts             public env validation; env.server.ts for secrets
  proxy.ts             session refresh + coarse route protection
supabase/
  migrations/          SQL migrations (schema, RLS, functions)
  templates/           Auth email templates
  tests/               test-only Supabase stubs
tests/
  unit/                Vitest unit tests
  db/                  Vitest database/RLS tests
docs/architecture/     architecture decision records
```

## Security principles

- Tenant isolation is enforced by PostgreSQL Row Level Security, not by hidden routes.
- The browser never decides subscription status, trial dates, roles or which business it may access.
- Secrets live only in server environment variables; `.env*` files are git-ignored.
- See [ADR 0002](docs/architecture/0002-multi-tenancy-and-rls.md) and
  [ADR 0003](docs/architecture/0003-trials-and-entitlements.md).
