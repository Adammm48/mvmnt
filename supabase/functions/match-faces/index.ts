/**
 * Face matching — the seam where a managed recognition API plugs in.
 *
 * ADR 0005 §2: face-matching is BOUGHT, not built. This function is the whole
 * of the club's side of that purchase — everything else (opt-in, matches,
 * deletion, the gallery filter) is schema and RPCs that already work.
 *
 * Called with { run_id } when a gallery is published. It should:
 *
 *   1. Enrol any face_optins rows with provider_face_id IS NULL, by signing a
 *      short-lived URL for selfies/<user_id> and sending it to the provider;
 *      write the returned face id back.
 *   2. For each photo in the run's gallery, ask the provider which enrolled
 *      faces appear; insert photo_matches rows with the confidence.
 *   3. On a disable_photo_matching audit entry, delete the provider-side face.
 *
 * REPLACE ME: the provider call. It needs an account and a budget the club
 * has not chosen (AWS Rekognition or equivalent — docs/open-items.md). Until
 * both exist this function refuses loudly rather than pretending: the same
 * pattern as dev_mark_paid, because a stub that silently succeeds teaches
 * everyone the feature works when it does not.
 *
 * The cost model this preserves: matching runs ONCE per published gallery
 * (provider bills per image), and viewing matches afterwards is free — they
 * are rows.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (auth !== expected) {
    return new Response(JSON.stringify({ error: 'service role only' }), { status: 401 });
  }

  const providerKey = Deno.env.get('FACE_PROVIDER_KEY');
  if (!providerKey) {
    // The honest state, said plainly and logged where an organiser's developer
    // will find it. Nothing downstream breaks: galleries publish, members see
    // every photo — "photos of you" simply stays empty, and the app says why.
    return new Response(
      JSON.stringify({
        matched: 0,
        skipped: true,
        reason:
          'FACE_PROVIDER_KEY is not set. Face matching needs a recognition-service account (see docs/open-items.md) — everything else about the feature is built and waiting.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { run_id } = await req.json().catch(() => ({}));
  if (!run_id) {
    return new Response(JSON.stringify({ error: 'run_id required' }), { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Guard the cost model even when live: only published galleries, ever.
  const { data: run } = await supabase
    .from('runs')
    .select('id, photos_published_at')
    .eq('id', run_id)
    .single();
  if (!run?.photos_published_at) {
    return new Response(JSON.stringify({ error: 'gallery is not published' }), { status: 409 });
  }

  // REPLACE ME when the provider account exists: enrolment + per-photo search
  // as described in the header. Left unimplemented rather than mocked — a mock
  // here would write plausible-looking matches that are lies.
  return new Response(
    JSON.stringify({
      matched: 0,
      skipped: true,
      reason: 'Provider integration not yet written — FACE_PROVIDER_KEY is set but no provider code exists. See ADR 0005 §2.',
    }),
    { status: 501, headers: { 'Content-Type': 'application/json' } },
  );
});
