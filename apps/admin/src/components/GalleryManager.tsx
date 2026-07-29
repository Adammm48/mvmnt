import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toMemberMessage } from '@mvmnt/shared';
import type { Database } from '@mvmnt/shared';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';

type PhotoCategory = Database['public']['Enums']['photo_category'];
type Photo = Database['public']['Tables']['run_photos']['Row'];

const BUCKET = 'gallery-media';

/** The club's Drive folders, kept as-is (App Spec §4.8), in the day's order. */
const CATEGORIES: { value: PhotoCategory; label: string }[] = [
  { value: 'pre_run', label: 'Pre-run' },
  { value: 'run', label: 'The run' },
  { value: 'after', label: 'After' },
  { value: 'camera', label: 'Camera' },
];

/**
 * The run's photo gallery, from the club's side.
 *
 * Uploads go straight to the private gallery-media bucket with the organiser's
 * own session — the bucket policy checks is_admin(), same as everything else.
 * Each upload also registers a run_photos row, which is what members' access
 * is gated on: an object without a row is invisible, not leaked.
 *
 * Publishing is deliberately a separate button with a confirm, because it
 * notifies everyone who checked in. Uploading over a few days is silent.
 */
export function GalleryManager({
  runId,
  photosPublishedAt,
  onPublished,
}: {
  runId: string;
  photosPublishedAt: string | null;
  onPublished: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<PhotoCategory>('run');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('run_photos')
      .select('*')
      .eq('run_id', runId)
      .order('category')
      .order('created_at');
    if (loadError) {
      setError(toMemberMessage(loadError));
      return;
    }
    setPhotos(data ?? []);

    // The bucket is private, so previews are short-lived signed URLs rather
    // than public ones. An hour outlives any editing session.
    if (data && data.length > 0) {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(data.map((p) => p.storage_path), 3600);
      const map: Record<string, string> = {};
      signed?.forEach((s, i) => {
        if (s.signedUrl) map[data[i].storage_path] = s.signedUrl;
      });
      setPreviews(map);
    }
  }, [runId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function upload(files: FileList) {
    setBusy(true);
    setError(null);
    let uploaded = 0;

    for (const file of Array.from(files)) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      // Random suffix rather than the original filename: fifty photos off one
      // camera are IMG_0001.jpg upwards, and two organisers' batches collide.
      const path = `${runId}/${category}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type });
      if (uploadError) {
        setError(toMemberMessage(uploadError, `Could not upload ${file.name}.`));
        break;
      }

      const { error: rowError } = await supabase.from('run_photos').insert({
        run_id: runId,
        category,
        storage_path: path,
      });
      if (rowError) {
        // The row is what grants members access, so an object without one is
        // just invisible — but tidy it up rather than leaving orphans.
        await supabase.storage.from(BUCKET).remove([path]);
        setError(toMemberMessage(rowError, `Could not register ${file.name}.`));
        break;
      }
      uploaded += 1;
    }

    setBusy(false);
    if (uploaded > 0) {
      toast.success(
        `${uploaded} photo${uploaded === 1 ? '' : 's'} added`,
        photosPublishedAt
          ? 'The gallery is live, so members can see them already.'
          : 'Members see nothing until you publish the gallery.',
      );
    }
    await reload();
  }

  async function remove(photo: Photo) {
    const ok = await confirm({
      title: 'Remove this photo?',
      message: 'It comes out of the gallery and the file is deleted. There is no undo.',
      confirmLabel: 'Remove it',
      tone: 'danger',
    });
    if (!ok) return;

    setBusy(true);
    const { error: rowError } = await supabase.from('run_photos').delete().eq('id', photo.id);
    if (rowError) {
      setBusy(false);
      toast.error("Couldn't remove it", toMemberMessage(rowError));
      return;
    }
    await supabase.storage.from(BUCKET).remove([photo.storage_path]);
    setBusy(false);
    await reload();
  }

  async function publish() {
    const ok = await confirm({
      title: photosPublishedAt ? 'Publish the gallery again?' : 'Publish the gallery?',
      message: photosPublishedAt
        ? 'The new photos go live. Nobody is notified again — the club was already told.'
        : 'Everyone who checked in at this run gets a notification that the photos are up.',
      confirmLabel: 'Publish',
    });
    if (!ok) return;

    setBusy(true);
    const { error: publishError } = await supabase.rpc('admin_publish_gallery', {
      p_run_id: runId,
    });
    setBusy(false);
    if (publishError) {
      toast.error("Couldn't publish the gallery", toMemberMessage(publishError));
      return;
    }
    toast.success(
      'Gallery published',
      photosPublishedAt ? 'The new photos are live.' : 'Everyone who was there has been told.',
    );
    onPublished();
  }

  const byCategory = (c: PhotoCategory) => photos.filter((p) => p.category === c);

  return (
    <div className="field">
      <label>The gallery</label>
      <div className="hint">
        The same folders as the club Drive: pre-run, the run itself, after, and the
        photographer's camera. Pick a folder, then add photos to it —{' '}
        {photosPublishedAt
          ? 'the gallery is live, so new photos appear as soon as they upload.'
          : 'members see nothing until you publish.'}
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="inline" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={category === c.value ? 'primary' : ''}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
            {byCategory(c.value).length > 0 && ` · ${byCategory(c.value).length}`}
          </button>
        ))}
      </div>

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={busy}
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = '';
        }}
        style={{ padding: 6, marginTop: 10 }}
      />
      {busy && <div className="hint">Working…</div>}

      {byCategory(category).length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            gap: 8,
            marginTop: 10,
          }}
        >
          {byCategory(category).map((photo) => (
            <div key={photo.id} style={{ position: 'relative' }}>
              {previews[photo.storage_path] ? (
                <img
                  src={previews[photo.storage_path]}
                  alt="Gallery photo"
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    objectFit: 'cover',
                    borderRadius: 8,
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    borderRadius: 8,
                    background: 'var(--border)',
                  }}
                />
              )}
              <button
                type="button"
                className="danger"
                onClick={() => remove(photo)}
                disabled={busy}
                style={{ position: 'absolute', top: 4, right: 4, padding: '2px 8px' }}
                aria-label="Remove this photo"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {photos.length > 0 && (
        <div className="inline" style={{ marginTop: 12 }}>
          <button type="button" className="primary" onClick={publish} disabled={busy}>
            {photosPublishedAt ? 'Publish the new photos' : 'Publish the gallery'}
          </button>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {photosPublishedAt
              ? 'Live. Publishing again does not notify people twice.'
              : `${photos.length} photo${photos.length === 1 ? '' : 's'} waiting. Publishing notifies everyone who checked in.`}
          </span>
        </div>
      )}
    </div>
  );
}
