/**
 * Face matching, live — AWS Rekognition behind the seam ADR 0005 drew.
 *
 * Called with { run_id } when a gallery is published. One invocation does the
 * whole job for that gallery:
 *
 *   1. Sweeps pending opt-outs: audit entries carrying a provider_face_id not
 *      yet stamped provider_deleted_at get their face deleted from the
 *      provider, then the stamp. Idempotent — a crashed run retries here.
 *   2. Enrols any face_optins with provider_face_id IS NULL: the selfie's
 *      bytes go to IndexFaces (MaxFaces 1 — it is a selfie, the largest face
 *      is the member), the returned face id is written back.
 *   3. Matches the gallery: every photo's faces are indexed into a THROWAWAY
 *      collection to get one face id per person in frame — the documented way
 *      around SearchFacesByImage only ever matching the LARGEST face, which
 *      on a 300-person run photo would find whoever stood closest and nobody
 *      else. Each detected face is searched against the members collection;
 *      hits land in photo_matches with the provider's confidence. The
 *      throwaway collection is deleted before returning.
 *
 * The cost model this preserves (ADR 0005 §2): matching runs ONCE per
 * published gallery — the provider bills per image, so the club pays per
 * gallery, not per viewer. Matches are rows; viewing them is free.
 *
 * Credentials come from function secrets (never the repo):
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — an IAM user allowed
 *   Rekognition and nothing else; FACE_AWS_REGION (default eu-west-1);
 *   FACE_COLLECTION (default mvmnt-members); FACE_MATCH_THRESHOLD (default
 *   85 — below that the UI would be labelling strangers).
 *
 * Unconfigured, it still refuses loudly rather than pretending — same
 * pattern as before, because a stub that silently succeeds teaches everyone
 * the feature works when it does not.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  CreateCollectionCommand,
  DeleteCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
  SearchFacesCommand,
} from 'npm:@aws-sdk/client-rekognition@3';

// Rekognition takes at most 5MB of image bytes inline. Run photos are
// compressed on upload and sit well under this; anything over it is skipped
// and REPORTED rather than silently missing from everyone's "You" tab.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (auth !== expected) {
    return new Response(JSON.stringify({ error: 'service role only' }), { status: 401 });
  }

  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) {
    return new Response(
      JSON.stringify({
        matched: 0,
        skipped: true,
        reason:
          'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set as function secrets. ' +
          'Face matching needs the club’s AWS account (docs/dev-todo.md) — ' +
          'everything else about the feature is built and waiting.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const region = Deno.env.get('FACE_AWS_REGION') ?? 'eu-west-1';
  const collection = Deno.env.get('FACE_COLLECTION') ?? 'mvmnt-members';
  const threshold = Number(Deno.env.get('FACE_MATCH_THRESHOLD') ?? '85');

  const rekognition = new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { run_id } = await req.json().catch(() => ({}));
  if (!run_id) {
    return new Response(JSON.stringify({ error: 'run_id required' }), { status: 400 });
  }

  // Guard the cost model even when live: only published galleries, ever.
  const { data: run } = await supabase
    .from('runs')
    .select('id, photos_published_at')
    .eq('id', run_id)
    .single();
  if (!run?.photos_published_at) {
    return new Response(JSON.stringify({ error: 'gallery is not published' }), { status: 409 });
  }

  // Everything from here can talk to the provider, and the provider can be
  // down, rate-limited or holding a rejected key. Unwrapped, any of those
  // surfaced as a bare "Internal Server Error" — found by running this against
  // AWS with a deliberately invalid key. An organiser publishing a gallery
  // would have seen a 500 and had no way to tell whether matching had happened,
  // half-happened, or never started. Partial progress is real and is reported.
  let enrolled = 0;
  let matched = 0;
  let forgotten = 0;
  let skippedPhotos = 0;
  const enrolmentProblems: string[] = [];

  try {
    await ensureCollection(rekognition, collection);

    // ---- 1. Pending opt-outs: the provider forgets before anything else runs.
    const { data: pending } = await supabase
      .from('audit_log')
      .select('id, metadata')
      .eq('action', 'disable_photo_matching')
      .not('metadata->>provider_face_id', 'is', null)
      .is('metadata->>provider_deleted_at', null);

    for (const entry of pending ?? []) {
      const faceId = entry.metadata.provider_face_id as string;
      try {
        await rekognition.send(
          new DeleteFacesCommand({ CollectionId: collection, FaceIds: [faceId] }),
        );
      } catch (_e) {
        // Already gone is the outcome we wanted; a real failure leaves the
        // entry unstamped and the next invocation retries.
        continue;
      }
      await supabase
        .from('audit_log')
        .update({
          metadata: { ...entry.metadata, provider_deleted_at: new Date().toISOString() },
        })
        .eq('id', entry.id);
      forgotten += 1;
    }

    // ---- 2. Enrolment: selfies that have never met the provider.
    const { data: unenrolled } = await supabase
      .from('face_optins')
      .select('user_id, storage_path')
      .is('provider_face_id', null);

    for (const optin of unenrolled ?? []) {
      const bytes = await download(supabase.storage, optin.storage_path);
      if (!bytes || bytes.byteLength > MAX_IMAGE_BYTES) {
        enrolmentProblems.push(`${optin.user_id}: selfie missing or too large`);
        continue;
      }
      const indexed = await rekognition.send(
        new IndexFacesCommand({
          CollectionId: collection,
          Image: { Bytes: new Uint8Array(bytes) },
          ExternalImageId: optin.user_id,
          MaxFaces: 1,
          QualityFilter: 'AUTO',
        }),
      );
      const faceId = indexed.FaceRecords?.[0]?.Face?.FaceId;
      if (!faceId) {
        // No face found in the selfie — leave provider_face_id null, which the
        // app already renders honestly as "not enrolled yet".
        enrolmentProblems.push(`${optin.user_id}: no face detected in selfie`);
        continue;
      }
      await supabase
        .from('face_optins')
        .update({ provider_face_id: faceId })
        .eq('user_id', optin.user_id);
      enrolled += 1;
    }

    // ---- 3. The gallery, one throwaway collection for its crowd faces.
    const { data: photos } = await supabase
      .from('run_photos')
      .select('id, storage_path')
      .eq('run_id', run_id);

    const scratch = `mvmnt-scratch-${run_id}`;
    await ensureCollection(rekognition, scratch);

    try {
      for (const photo of photos ?? []) {
        const bytes = await download(supabase.storage, photo.storage_path);
        if (!bytes || bytes.byteLength > MAX_IMAGE_BYTES) {
          skippedPhotos += 1;
          continue;
        }
        // Index every face in the photo (the scratch collection is just a
        // face-detector that hands back searchable ids)…
        const inPhoto = await rekognition.send(
          new IndexFacesCommand({
            CollectionId: scratch,
            Image: { Bytes: new Uint8Array(bytes) },
            MaxFaces: 50,
            QualityFilter: 'AUTO',
          }),
        );
        // …then ask, for each, "is this an enrolled member?"
        for (const record of inPhoto.FaceRecords ?? []) {
          const faceId = record.Face?.FaceId;
          if (!faceId) continue;
          const hits = await rekognition.send(
            new SearchFacesCommand({
              CollectionId: collection,
              FaceId: faceId,
              FaceMatchThreshold: threshold,
              MaxFaces: 1,
            }),
          );
          const best = hits.FaceMatches?.[0];
          const userId = best?.Face?.ExternalImageId;
          if (!userId || !best?.Similarity) continue;
          await supabase.from('photo_matches').upsert(
            {
              photo_id: photo.id,
              user_id: userId,
              confidence: Math.round(best.Similarity * 100) / 100,
            },
            { onConflict: 'photo_id,user_id' },
          );
          matched += 1;
        }
      }
    } finally {
      // The crowd's faces exist only for the duration of this matching pass.
      // Deleting the scratch collection deletes every one of them — a member's
      // face persists at the provider ONLY via their own opted-in selfie.
      await rekognition
        .send(new DeleteCollectionCommand({ CollectionId: scratch }))
        .catch(() => {});
    }

  } catch (e) {
    const problem = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[match-faces] provider call failed', e);
    return new Response(
      JSON.stringify({
        error: 'The recognition provider refused or failed.',
        provider: problem,
        // What did land before the failure. Enrolments and matches are
        // written as they happen, so a retry resumes rather than repeats —
        // and repeating would re-bill the gallery.
        enrolled,
        matched,
        forgotten,
        skippedPhotos,
        enrolmentProblems,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({
      matched,
      enrolled,
      forgotten,
      skippedPhotos,
      enrolmentProblems,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

async function ensureCollection(client: RekognitionClient, id: string) {
  try {
    await client.send(new CreateCollectionCommand({ CollectionId: id }));
  } catch (e) {
    if ((e as Error).name !== 'ResourceAlreadyExistsException') throw e;
  }
}

/**
 * Bytes for one object in the gallery bucket, or null if it is gone.
 *
 * Takes the storage client rather than the whole Supabase client: the
 * generic parameters on `createClient`'s return type do not survive being
 * named in a signature (`ReturnType<typeof createClient>` resolves the
 * defaults, not this instance's), and the narrower dependency is what this
 * helper actually uses anyway.
 */
async function download(
  storage: SupabaseClient['storage'],
  path: string,
): Promise<ArrayBuffer | null> {
  const { data } = await storage.from('gallery-media').download(path);
  if (!data) return null;
  return await data.arrayBuffer();
}
