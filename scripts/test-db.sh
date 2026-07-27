#!/usr/bin/env bash
# Run the database test suite against the local Supabase stack.
#
#   npm run db:test
#
# Each test file wraps itself in BEGIN/ROLLBACK, so the suite leaves the
# database exactly as it found it and can be run against a seeded stack.
set -uo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Find a psql. Homebrew's postgresql@N formulae are keg-only, so a perfectly
# good psql is often installed but absent from PATH.
PSQL_BIN="$(command -v psql || true)"
if [ -z "$PSQL_BIN" ]; then
  for c in /opt/homebrew/opt/postgresql@*/bin/psql /usr/local/opt/postgresql@*/bin/psql; do
    [ -x "$c" ] && PSQL_BIN="$c" && break
  done
fi

# Files are piped on stdin rather than passed with -f, so the same invocation
# works whether psql is local or inside the container (where these paths do not
# exist).
if [ -n "$PSQL_BIN" ]; then
  run_sql() { "$PSQL_BIN" "$DB_URL" -v ON_ERROR_STOP=1 -q --no-psqlrc < "$1" 2>&1; }
  probe()   { "$PSQL_BIN" "$DB_URL" -c 'select 1' >/dev/null 2>&1; }
else
  echo "  (no local psql found — using the Supabase container)"
  CID="$(docker ps --filter name=supabase_db --format '{{.Names}}' | head -1)"
  if [ -z "$CID" ]; then
    echo "Supabase database container not running. Try: npm run db:start" >&2
    exit 1
  fi
  run_sql() { docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$1" 2>&1; }
  probe()   { docker exec -i "$CID" psql -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; }
fi

if ! probe; then
  echo "Cannot reach the database. Is the stack running? Try: npm run db:start" >&2
  exit 1
fi

if ! out=$(run_sql "$ROOT/supabase/tests/00_helpers.sql"); then
  echo "Failed to load test helpers:" >&2
  echo "$out" | head -5 >&2
  exit 1
fi

failed=0
for f in "$ROOT"/supabase/tests/[0-9]*.sql; do
  name=$(basename "$f")
  [ "$name" = "00_helpers.sql" ] && continue
  printf '  %-28s ' "$name"
  if out=$(run_sql "$f"); then
    echo "PASS"
  else
    echo "FAIL"
    echo "$out" | grep -E "FAILED|ERROR" | head -4 | sed 's/^/      /'
    failed=1
  fi
done

if [ "$failed" -eq 0 ]; then
  echo "  all database tests passed"
else
  echo "  database tests FAILED" >&2
fi
exit "$failed"
