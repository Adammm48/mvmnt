import { supabase } from './supabase';

/**
 * Turning a stored media reference into something an <Image> can load.
 *
 * WHY THIS EXISTS
 *
 * Product photos, run covers and cover videos were stored as ABSOLUTE URLs
 * with the host baked in — `http://127.0.0.1:54321/storage/v1/...`. That works
 * on the machine that wrote them and nowhere else:
 *
 *   · on a real phone, 127.0.0.1 is THE PHONE, so every image is blank white;
 *   · in production the host is the hosted project, so rows written locally
 *     would point at a laptop that is not on the internet;
 *   · move the project and all 70 rows break at once.
 *
 * The owner found the blank shop on an iPhone. Avatars already did the right
 * thing (store a path, build the URL at render time), so this generalises that
 * to every bucket rather than inventing a second pattern.
 *
 * Absolute URLs still render, so old rows and genuinely external images (a
 * sponsor's own logo, say) keep working — the fix is additive, not a cutover.
 */
export function mediaUri(
  stored: string | null | undefined,
  bucket = 'run-media',
): string | null {
  if (!stored) return null;

  // A storage URL from ANY host — the local stack, the hosted project, or a
  // laptop that no longer exists — is rebuilt against wherever the database
  // lives right now. This is what rescues the 70 seeded rows on a real phone,
  // and what makes every stored URL survive the move to production: the path
  // is the durable part, the host never was.
  const storageMatch = stored.match(/^https?:\/\/[^/]+\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (storageMatch) {
    return supabase.storage.from(storageMatch[1]!).getPublicUrl(storageMatch[2]!).data.publicUrl;
  }

  // Any other full address is genuinely external (a sponsor's own logo) and
  // passes through untouched.
  if (/^https?:\/\//.test(stored)) return stored;

  // A stored path. It may carry its bucket as the first segment
  // ("run-media/product-tee.jpg") or be bare ("product-tee.jpg").
  const path = stored.startsWith(`${bucket}/`)
    ? stored.slice(bucket.length + 1)
    : stored;

  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
