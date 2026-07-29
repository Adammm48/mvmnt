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

# ---------------------------------------------------------------------------
# Product tiles — public club imagery like the run covers, so run-media is
# the right bucket. Real product photos are the club's to take; these keep
# the shop from being a grid of grey boxes until then.
# ---------------------------------------------------------------------------
attach_product() {
  local name="$1" object="$2"
  curl -s -o /dev/null -X PATCH "$API/rest/v1/products?name=eq.$(printf '%s' "$name" | sed 's/ /%20/g')" \
    -H "Authorization: Bearer $SERVICE" \
    -H "apikey: $SERVICE" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{\"image_url\":\"$API/storage/v1/object/public/run-media/$object\"}"
}

declare -a PRODUCTS=(
  "MVMNT Club Tee|product-tee.jpg"
  "MVMNT Cap|product-cap.jpg"
  "MVMNT Bottle|product-bottle.jpg"
  "Winter Running Jacket|product-jacket.jpg"
)

for pair in "${PRODUCTS[@]}"; do
  pname="${pair%%|*}"
  file="${pair##*|}"
  [ -f "$MEDIA/$file" ] || continue
  upload "$MEDIA/$file" "$file" "image/jpeg"
  attach_product "$pname" "$file"
done

echo "  seeded product tiles"

# ---------------------------------------------------------------------------
# A published gallery on the most recent finished run, so the member flow —
# run detail → "See the photos" → the grid — works straight off a reset.
#
# Uploads go to the PRIVATE gallery-media bucket (path, not public URL), and
# each one is registered as a run_photos row, because the row is what member
# access is gated on. Publication is stamped directly rather than through
# admin_publish_gallery(): the RPC would also enqueue a real photos-ready
# notification, and seed data should not leave sends in the queue.
# ---------------------------------------------------------------------------
GALLERY_RUN_ID=$(curl -s "$API/rest/v1/runs?title=eq.Last%20Saturday%206K&select=id&limit=1" \
  -H "Authorization: Bearer $SERVICE" -H "apikey: $SERVICE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

if [ -n "$GALLERY_RUN_ID" ]; then
  upload_gallery() {
    local file="$1" object="$2"
    curl -s -o /dev/null -X POST "$API/storage/v1/object/gallery-media/$object" \
      -H "Authorization: Bearer $SERVICE" \
      -H "Content-Type: image/jpeg" \
      -H "x-upsert: true" \
      --data-binary "@$file"
  }

  declare -a GALLERY=(
    "pre_run|gallery-pre-run-1.jpg"
    "pre_run|gallery-pre-run-2.jpg"
    "run|gallery-run-1.jpg"
    "run|gallery-run-2.jpg"
    "run|gallery-run-3.jpg"
    "after|gallery-after-1.jpg"
    "after|gallery-after-2.jpg"
    "camera|gallery-camera-1.jpg"
  )

  for pair in "${GALLERY[@]}"; do
    category="${pair%%|*}"
    name="${pair##*|}"
    [ -f "$MEDIA/$name" ] || continue
    object="$GALLERY_RUN_ID/$category/$name"
    upload_gallery "$MEDIA/$name" "$object"
    curl -s -o /dev/null -X POST "$API/rest/v1/run_photos?on_conflict=storage_path" \
      -H "Authorization: Bearer $SERVICE" \
      -H "apikey: $SERVICE" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=minimal,resolution=merge-duplicates" \
      -d "{\"run_id\":\"$GALLERY_RUN_ID\",\"category\":\"$category\",\"storage_path\":\"$object\"}"
  done

  curl -s -o /dev/null -X PATCH "$API/rest/v1/runs?id=eq.$GALLERY_RUN_ID" \
    -H "Authorization: Bearer $SERVICE" \
    -H "apikey: $SERVICE" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{\"photos_published_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

  echo "  seeded a published gallery on Last Saturday 6K"
fi
