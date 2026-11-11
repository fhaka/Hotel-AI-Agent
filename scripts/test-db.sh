#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Runs the database (RLS / constraint) test-suite against a throwaway local
# PostgreSQL cluster. No Docker or Supabase account required.
#
#   npm run test:db                 # run the DB test-suite
#   scripts/test-db.sh <command...> # run any command with DATABASE_URL_TEST
#                                   # pointing at a freshly migrated database
#
# Requires PostgreSQL 15+ server binaries (initdb, pg_ctl) on the machine.
# If DATABASE_URL_TEST is already set, the script uses that database instead
# and skips cluster creation (it must be an EMPTY, disposable database).
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PGTEST_PORT:-54329}"
if [[ $# -gt 0 ]]; then CMD=("$@"); else CMD=(npx vitest run --project db); fi

apply_schema() {
  local url="$1"
  psql "$url" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/supabase_stub.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "  applying $(basename "$f")" >&2
    psql "$url" -v ON_ERROR_STOP=1 -q -f "$f"
  done
}

if [[ -n "${DATABASE_URL_TEST:-}" ]]; then
  # Existing database. If it is a real Supabase Postgres (auth schema already
  # present) only add the GoTrue columns; otherwise install the full stub.
  if psql "$DATABASE_URL_TEST" -Atqc "select to_regclass('auth.users') is not null" | grep -q t; then
    # auth.users is owned by supabase_admin; set SUPABASE_ADMIN_URL to run the shim.
    psql "${SUPABASE_ADMIN_URL:-$DATABASE_URL_TEST}" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/gotrue_shim.sql"
    for f in "$ROOT"/supabase/migrations/*.sql; do
      echo "  applying $(basename "$f")" >&2
      psql "$DATABASE_URL_TEST" -v ON_ERROR_STOP=1 -q -f "$f"
    done
    exec "${CMD[@]}"
  fi
  apply_schema "$DATABASE_URL_TEST" >&2
  exec "${CMD[@]}"
fi

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  echo "PostgreSQL server binaries not found. Install PostgreSQL 15+ or set PG_BIN / DATABASE_URL_TEST." >&2
  exit 1
fi

TMP="$(mktemp -d)"
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then
  # initdb refuses to run as root; use the postgres system user.
  chown postgres "$TMP"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() {
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/pg.log" -w \
  -o "-p $PORT -k $TMP -c listen_addresses=localhost" start >/dev/null

export DATABASE_URL_TEST="postgresql://postgres@localhost:$PORT/postgres"
echo "Applying migrations to temporary cluster..." >&2
apply_schema "$DATABASE_URL_TEST" >&2
"${CMD[@]}"
