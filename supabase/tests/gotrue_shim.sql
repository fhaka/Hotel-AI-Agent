-- Columns/functions that GoTrue (Supabase Auth) adds at runtime. Only needed
-- when running the DB tests against a bare supabase/postgres image without the
-- Auth service. Safe to run repeatedly.
alter table auth.users add column if not exists raw_user_meta_data jsonb default '{}'::jsonb;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
grant execute on function auth.jwt() to anon, authenticated, service_role;
-- GoTrue's migrations replace the base image's legacy auth.uid() with this
-- version, which also understands the `request.jwt.claims` JSON setting.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
