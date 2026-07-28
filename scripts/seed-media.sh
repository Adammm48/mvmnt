#!/usr/bin/env bash
# Upload placeholder cover images (and, where generated, a cover clip) to local
# Storage and attach them to the seeded runs.
#
# Separate from seed.sql because SQL cannot upload a file — Storage is an HTTP
# API. Run after `supabase db reset`; `npm run db:reset` chains both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${SUPABASE_URL:-http://127.0.0.1:54321}"

# NOT A SECRET. This is the fixed demo service key that ships inside every
# `supabase start` container — it is identical on every developer's machine, is
# published in Supabase's own documentation, and only ever reaches a database
# running on localhost. It is inlined so the seed works with no setup.
#
# A real key must never appear in this repo. Set SUPABASE_SERVICE_ROLE_KEY in
# the environment to point this at anything other than the local stack.
SERVICE="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"
MEDIA="$ROOT/supabase/seed-media"

if [ ! -d "$MEDIA" ]; then
  echo "No seed media found. Run: python3 scripts/generate-placeholder-media.py" >&2
  exit 0
fi

upload() {
  local file="$1" name="$2" content_type="$3"
  # x-upsert makes re-seeding idempotent instead of failing on the second run.
  curl -s -o /dev/null -X POST "$API/storage/v1/object/run-media/$name" \
    -H "Authorization: Bearer $SERVICE" \
    -H "Content-Type: $content_type" \
    -H "x-upsert: true" \
    --data-binary "@$file"
}

attach() {
  local title="$1" column="$2" name="$3"
  curl -s -o /dev/null -X PATCH "$API/rest/v1/runs?title=eq.$(printf '%s' "$title" | sed 's/ /%20/g')" \
    -H "Authorization: Bearer $SERVICE" \
    -H "apikey: $SERVICE" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{\"$column\":\"$API/storage/v1/object/public/run-media/$name\"}"
}

declare -a IMAGES=(
  "Saturday 6K|saturday-6k.jpg"
  "Last Saturday 6K|saturday-6k.jpg"
  "Track Session|track-session.jpg"
  "Sunday Long Run|long-run.jpg"
  "Bank Holiday 10K|waterway.jpg"
)

for pair in "${IMAGES[@]}"; do
  title="${pair%%|*}"
  name="${pair##*|}"
  [ -f "$MEDIA/$name" ] || continue
  upload "$MEDIA/$name" "$name" "image/jpeg"
  attach "$title" "cover_image_url" "$name"
done

# One run gets a clip too, so the video path (RunHero) is exercised by the
# seed itself rather than sitting untested until someone uploads a real one.
# Only present if generate-placeholder-media.py's optional imageio-ffmpeg step
# ran — degrades silently to stills-only otherwise.
if [ -f "$MEDIA/saturday-6k.mp4" ]; then
  upload "$MEDIA/saturday-6k.mp4" "saturday-6k.mp4" "video/mp4"
  attach "Saturday 6K" "cover_video_url" "saturday-6k.mp4"
fi

echo "  seeded run cover images"
