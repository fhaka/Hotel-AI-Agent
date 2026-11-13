# Supabase setup

## 1. Create a project

Create a project at <https://supabase.com/dashboard>. Choose the region closest to your customers
(EU region if you serve EU businesses — relevant for GDPR).

## 2. Configure environment variables

```bash
cp .env.example .env.local
```

From **Project Settings → API Keys** copy:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- Publishable key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Secret key (`sb_secret_…`) → `SUPABASE_SECRET_KEY` (server only — never paste it into chat,
  client code, or a `NEXT_PUBLIC_` variable)

## 3. Apply the database migrations

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push --remote
```

`--remote` is required: newer CLI versions target a local Docker database by default and fail
with `ECONNREFUSED 127.0.0.1:54322` without it. The output must say the target is your
linked project.

## 4. Configure Auth (Dashboard → Authentication)

- **Sign In / Providers → Email**: enable *Confirm email*. Set minimum password length to 10 and
  require letters and digits (matches the app's validation).
- **URL Configuration**: Site URL = your `NEXT_PUBLIC_APP_URL` (e.g. `http://localhost:3000` in
  development). Add `http://localhost:3000/**` (and later your production domain `/**`) to
  *Redirect URLs*.
- **Email Templates** (recommended — links then work even if opened on another device):
  - *Confirm signup* link:
    `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`
    (`RedirectTo` is the app's `/auth/callback?next=…` URL, so a person who signed up from a team
    invitation returns to that invitation. It already contains `?`, hence the `&`. The Redirect
    URLs allow-list must include `http://localhost:3000/**` / your domain, otherwise Supabase
    substitutes the Site URL and the link breaks.)
  - *Reset password* link:
    `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`

  The same templates are in `supabase/templates/` and are used automatically by `supabase start`.
- **SMTP**: the built-in email sender is for testing only and is strictly rate-limited. Configure
  custom SMTP (e.g. Resend) before inviting real users.

## 5. Platform administrators

There is intentionally no UI or API to become a platform admin. Grant it in the SQL editor:

```sql
insert into public.platform_admins (user_id) values ('<auth user uuid>');
```

## Local development with Docker (optional)

`npx supabase start` runs the full stack locally using `supabase/config.toml` (email confirmations
on; emails are captured by the local Mailpit inbox shown in the command output).
