import { supabase } from './supabase';

/**
 * The console's twin of the app's media helper (apps/mobile/src/lib/media.ts).
 *
 * Stored media references are PATHS; the host is worked out at render time.
 * The blank-shop bug on a real phone came from doing it the other way — 70
 * rows with http://127.0.0.1 baked in, correct on the machine that wrote them
 * and nowhere else. Absolute URLs from any storage host are rebuilt; genuinely
 * external URLs (a sponsor's own site) pass through.
 */
export function mediaUrl(stored: string | null | undefined, bucket = 'run-media'): string | null {
  if (!stored) return null;

  const storageMatch = stored.match(
    /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/([^/]+)\/([^?]+)/,
  );
  if (storageMatch) {
    return supabase.storage.from(storageMatch[1]!).getPublicUrl(storageMatch[2]!).data.publicUrl;
  }

  if (/^https?:\/\//.test(stored)) return stored;

  const path = stored.startsWith(`${bucket}/`) ? stored.slice(bucket.length + 1) : stored;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Upload a picked file and return the PATH to store.
 *
 * The filename carries a timestamp, so every replacement is a new URL — which
 * is the cache-bust. The old `?v=` query trick forced absolute URLs into the
 * database; a versioned path gets the same freshness while keeping the stored
 * value portable. Older files under the same prefix are cleaned up so
 * replacements do not accumulate as orphans.
 */
export async function uploadMedia(
  file: File,
  prefix: string,
  bucket = 'run-media',
): Promise<{ path: string } | { error: string }> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const path = `${prefix}-${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) return { error: error.message };

  // Sweep older versions under this prefix. Best-effort: a leftover orphan is
  // storage dust, not a defect worth failing the upload over.
  const folder = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
  const base = prefix.slice(folder ? folder.length + 1 : 0);
  const { data: siblings } = await supabase.storage.from(bucket).list(folder);
  const stale = (siblings ?? [])
    .filter((f) => f.name.startsWith(`${base}-`) && !path.endsWith(f.name))
    .map((f) => (folder ? `${folder}/${f.name}` : f.name));
  if (stale.length > 0) await supabase.storage.from(bucket).remove(stale);

  return { path };
}
