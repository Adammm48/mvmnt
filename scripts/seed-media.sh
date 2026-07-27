#!/usr/bin/env bash
# Upload placeholder cover images to local Storage and attach them to the
# seeded runs.
#
# Separate from seed.sql because SQL cannot upload a file — Storage is an HTTP
# API. Run after `supabase db reset`; `npm run db:reset` chains both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${SUPABASE_URL:-http://127.0.0.1:54321}"
# Local-only default key. Production uses the real one from the environment.
SERVICE="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"
MEDIA="$ROOT/supabase/seed-media"

if [ ! -d "$MEDIA" ]; then
  echo "No seed media found. Run: python3 scripts/generate-placeholder-media.py" >&2
  exit 0
fi

upload() {
  local file="$1" name="$2"
  # x-upsert makes re-seeding idempotent instead of failing on the second run.
  curl -s -o /dev/null -X POST "$API/storage/v1/object/run-media/$name" \
    -H "Authorization: Bearer $SERVICE" \
    -H "Content-Type: image/jpeg" \
    -H "x-upsert: true" \
    --data-binary "@$file"
}

attach() {
  local title="$1" name="$2"
  curl -s -o /dev/null -X PATCH "$API/rest/v1/runs?title=eq.$(printf '%s' "$title" | sed 's/ /%20/g')" \
    -H "Authorization: Bearer $SERVICE" \
    -H "apikey: $SERVICE" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{\"cover_image_url\":\"$API/storage/v1/object/public/run-media/$name\"}"
}

declare -a PAIRS=(
  "Saturday 6K|saturday-6k.jpg"
  "Last Saturday 6K|saturday-6k.jpg"
  "Track Session|track-session.jpg"
  "Sunday Long Run|long-run.jpg"
  "Bank Holiday Special (unpublished)|waterway.jpg"
)

for pair in "${PAIRS[@]}"; do
  title="${pair%%|*}"
  name="${pair##*|}"
  [ -f "$MEDIA/$name" ] || continue
  upload "$MEDIA/$name" "$name"
  attach "$title" "$name"
done

echo "  seeded run cover images"
