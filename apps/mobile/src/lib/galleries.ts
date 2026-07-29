import { supabase } from './supabase';

export type GalleryCard = {
  id: string;
  title: string;
  starts_at: string;
  photos_published_at: string;
  /** How many photos the gallery holds. */
  count: number;
  /** A signed URL for one photo, as the card's cover. Empty when signing fails. */
  coverUrl: string;
};

/**
 * Published galleries as cards: title, date, photo count, and one real photo
 * as the cover.
 *
 * The first version of the home section was a text row saying "See the
 * photos →", which the owner rightly wanted labelled properly — a gallery
 * announced without a picture is a door with no window. The cover is the
 * FIRST photo by upload order, so the club controls it by uploading the best
 * one first, rather than the app guessing at "best".
 */
export async function loadGalleries(opts?: {
  limit?: number;
  sinceDays?: number;
}): Promise<GalleryCard[]> {
  let query = supabase
    .from('runs')
    .select('id, title, starts_at, photos_published_at')
    .not('photos_published_at', 'is', null)
    .order('photos_published_at', { ascending: false });

  if (opts?.sinceDays) {
    query = query.gte(
      'photos_published_at',
      new Date(Date.now() - opts.sinceDays * 86400_000).toISOString(),
    );
  }
  if (opts?.limit) query = query.limit(opts.limit);

  const { data: runs } = await query;
  if (!runs || runs.length === 0) return [];

  // Every photo row for these runs in one query, then counted and picked
  // client-side — at club scale a gallery is dozens of rows, not thousands,
  // and one round-trip beats N.
  const { data: photos } = await supabase
    .from('run_photos')
    .select('id, run_id, storage_path, created_at')
    .in('run_id', runs.map((r) => r.id))
    .order('created_at');

  const byRun = new Map<string, { count: number; cover: string }>();
  for (const p of photos ?? []) {
    const entry = byRun.get(p.run_id);
    if (entry) entry.count += 1;
    else byRun.set(p.run_id, { count: 1, cover: p.storage_path });
  }

  const coverPaths = [...byRun.values()].map((e) => e.cover);
  const { data: signed } =
    coverPaths.length > 0
      ? await supabase.storage.from('gallery-media').createSignedUrls(coverPaths, 3600)
      : { data: [] };
  const urlByPath = new Map(
    (signed ?? []).map((s, i) => [coverPaths[i]!, s.signedUrl ?? '']),
  );

  return runs
    .map((r) => {
      const entry = byRun.get(r.id);
      return {
        id: r.id,
        title: r.title,
        starts_at: r.starts_at,
        photos_published_at: r.photos_published_at!,
        count: entry?.count ?? 0,
        coverUrl: entry ? (urlByPath.get(entry.cover) ?? '') : '',
      };
    })
    // A published gallery with zero photos is an organiser mid-mistake;
    // showing members an empty promise helps nobody.
    .filter((g) => g.count > 0);
}

export function galleryDateLabel(startsAt: string): string {
  return new Date(startsAt).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}
