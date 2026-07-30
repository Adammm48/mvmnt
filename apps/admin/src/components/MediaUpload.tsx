import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toMemberMessage } from '@mvmnt/shared';
import { mediaUrl, uploadMedia } from '../lib/media';

type Props = {
  runId: string;
  label: string;
  hint: string;
  accept: string;
  currentUrl: string | null;
  /** Which column this writes back to. */
  column: 'cover_image_url' | 'cover_video_url';
  onChanged: () => void;
};

/**
 * Upload a cover photo or clip for a run.
 *
 * Goes straight from the browser to Storage with the organiser's own session —
 * the bucket's insert policy checks is_admin(), so authorisation is enforced by
 * the same rule as everything else rather than by this component being hidden.
 *
 * STORES A PATH, NOT A URL. This component used to write the full public URL
 * (with a ?v= cache-buster) into the runs table, which is how 66 covers ended
 * up bound to one machine's address and rendered blank on a real phone. The
 * upload helper versions the filename instead — every replacement is a new
 * URL, which is the cache-bust, and the stored value stays portable.
 */
export function MediaUpload({ runId, label, hint, accept, currentUrl, column, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    const uploaded = await uploadMedia(file, `runs/${runId}/${column}`);
    if ('error' in uploaded) {
      setBusy(false);
      setError(uploaded.error);
      return;
    }

    // Written as an explicit branch rather than a computed key: the generated
    // Update type rejects an index signature, and losing that type safety on
    // the one place that writes a path back would be a poor trade.
    const patch =
      column === 'cover_image_url'
        ? { cover_image_url: uploaded.path }
        : { cover_video_url: uploaded.path };

    const { error: saveError } = await supabase.from('runs').update(patch).eq('id', runId);

    setBusy(false);
    if (saveError) {
      setError(toMemberMessage(saveError));
      return;
    }
    onChanged();
  }

  async function clear() {
    setBusy(true);
    setError(null);
    const patch =
      column === 'cover_image_url' ? { cover_image_url: null } : { cover_video_url: null };

    const { error: saveError } = await supabase.from('runs').update(patch).eq('id', runId);
    setBusy(false);
    if (saveError) {
      setError(toMemberMessage(saveError));
      return;
    }
    onChanged();
  }

  return (
    <div className="field">
      <label>{label}</label>

      {mediaUrl(currentUrl) && (
        <div style={{ marginBottom: 10 }}>
          {column === 'cover_image_url' ? (
            <img
              src={mediaUrl(currentUrl)!}
              alt={`Current ${label.toLowerCase()}`}
              style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8 }}
            />
          ) : (
            <video
              src={mediaUrl(currentUrl)!}
              muted
              loop
              autoPlay
              playsInline
              style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8 }}
            />
          )}
        </div>
      )}

      {error && <div className="notice error">{error}</div>}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          // Reset so choosing the same file twice still fires a change event.
          e.target.value = '';
        }}
        style={{ padding: 6 }}
      />

      <div className="hint">{hint}</div>

      {currentUrl && (
        <button type="button" className="link" onClick={clear} disabled={busy}>
          Remove
        </button>
      )}
      {busy && <div className="hint">Uploading…</div>}
    </div>
  );
}
