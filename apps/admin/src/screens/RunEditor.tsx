import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CLUB_TIMEZONE, toMemberMessage, type Run } from '@mvmnt/shared';
import { MediaUpload } from '../components/MediaUpload';

type Props = { runId: string | null; onDone: () => void };

/**
 * Create and edit a run.
 *
 * Publishing is a separate, explicit act rather than a side effect of saving:
 * publish_run() announces the run to every member and schedules both reminders,
 * so it must not be something an organiser can trigger by accident while
 * fixing a typo.
 */
export function RunEditor({ runId, onDone }: Props) {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(runId !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [meetingPoint, setMeetingPoint] = useState('');
  const [lat, setLat] = useState('30.0444');
  const [lng, setLng] = useState('31.2357');
  const [radius, setRadius] = useState('250');
  const [distance, setDistance] = useState('');
  const [capacity, setCapacity] = useState('');
  const [paceGroups, setPaceGroups] = useState('');

  const reload = async () => {
    const id = run?.id ?? runId;
    if (!id) return;
    const { data } = await supabase.from('runs').select('*').eq('id', id).maybeSingle();
    setRun(data ?? null);
  };

  useEffect(() => {
    if (!runId) return;
    supabase
      .from('runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRun(data);
          setTitle(data.title);
          setDescription(data.description ?? '');
          setStartsAt(toLocalInput(data.starts_at));
          setEndsAt(data.ends_at ? toLocalInput(data.ends_at) : '');
          setMeetingPoint(data.meeting_point_name);
          setLat(String(data.meeting_point_lat));
          setLng(String(data.meeting_point_lng));
          setRadius(String(data.check_in_radius_m));
          setDistance(data.distance_meters ? String(data.distance_meters) : '');
          setCapacity(data.capacity ? String(data.capacity) : '');
          setPaceGroups(data.pace_groups.join(', '));
        }
        setLoading(false);
      });
  }, [runId]);

  async function save() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      starts_at: fromLocalInput(startsAt),
      ends_at: endsAt ? fromLocalInput(endsAt) : null,
      meeting_point_name: meetingPoint.trim(),
      meeting_point_lat: Number(lat),
      meeting_point_lng: Number(lng),
      check_in_radius_m: Number(radius),
      distance_meters: distance ? Number(distance) : null,
      capacity: capacity ? Number(capacity) : null,
      pace_groups: paceGroups
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    };

    const result = runId
      ? await supabase.from('runs').update(payload).eq('id', runId).select().maybeSingle()
      : await supabase.from('runs').insert(payload).select().maybeSingle();

    setBusy(false);
    if (result.error) {
      setError(toMemberMessage(result.error));
      return;
    }
    setRun(result.data);
    setSuccess(runId ? 'Saved.' : 'Draft created. Publish it when you are ready.');
    if (!runId && result.data) {
      // Stay on the page so the organiser can publish without navigating back.
      window.history.replaceState(null, '', `?run=${result.data.id}`);
    }
  }

  async function publish() {
    if (!run) return;
    setBusy(true);
    setError(null);
    const { error: publishError } = await supabase.rpc('publish_run', { p_run_id: run.id });
    setBusy(false);
    if (publishError) {
      setError(toMemberMessage(publishError));
      return;
    }
    setSuccess('Published. Every member has been notified, and both reminders are scheduled.');
    const { data } = await supabase.from('runs').select('*').eq('id', run.id).maybeSingle();
    setRun(data ?? null);
  }

  async function cancel() {
    if (!run) return;
    const reason = window.prompt(
      'Why is this run cancelled? Members will see this.',
      'Weather',
    );
    if (reason === null) return;

    setBusy(true);
    setError(null);
    const { error: cancelError } = await supabase.rpc('cancel_run', {
      p_run_id: run.id,
      p_reason: reason || undefined,
    });
    setBusy(false);
    if (cancelError) {
      setError(toMemberMessage(cancelError));
      return;
    }
    setSuccess('Run cancelled. Pending reminders for it have been cancelled too.');
    const { data } = await supabase.from('runs').select('*').eq('id', run.id).maybeSingle();
    setRun(data ?? null);
  }

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <button className="link" onClick={onDone} style={{ marginBottom: 12 }}>
        ← All runs
      </button>
      <h2>{runId ? 'Edit run' : 'New run'}</h2>
      <p className="subtitle">
        Times are in {CLUB_TIMEZONE.replace('_', ' ')} — the same timezone members see.
      </p>

      {error && <div className="notice error">{error}</div>}
      {success && !error && <div className="notice success">{success}</div>}

      <div className="card">
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="starts">Starts</label>
            <input
              id="starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ends">Ends</label>
            <input
              id="ends"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
            <div className="hint">
              Leave blank to end the run by hand. If set, the run ends automatically and members
              who checked in get the "that's a wrap" notification.
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="meeting">Meeting point</label>
          <input id="meeting" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} />
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="lat">Latitude</label>
            <input id="lat" value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="lng">Longitude</label>
            <input id="lng" value={lng} onChange={(e) => setLng(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="radius">Check-in radius (metres)</label>
          <input id="radius" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
          <div className="hint">
            How close someone must be for the app to offer check-in. 250m suits a normal run;
            widen it for a large event where the crowd spreads out.
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="distance">Distance (metres)</label>
            <input
              id="distance"
              type="number"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="capacity">Capacity</label>
            <input
              id="capacity"
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <div className="hint">
              Leave blank for unlimited. If set, anyone beyond it joins a waitlist and is promoted
              automatically when someone drops out.
            </div>
          </div>
        </div>

        {run && (
          <>
            <MediaUpload
              runId={run.id}
              column="cover_image_url"
              label="Cover photo"
              accept="image/jpeg,image/png,image/webp"
              hint="Shown behind the run on the home screen and at the top of the run page. Landscape works best."
              currentUrl={run.cover_image_url}
              onChanged={reload}
            />
            <MediaUpload
              runId={run.id}
              column="cover_video_url"
              label="Cover clip (optional)"
              accept="video/mp4,video/quicktime"
              hint="A few seconds, no longer. It plays muted and on a loop, so it must not rely on sound."
              currentUrl={run.cover_video_url}
              onChanged={reload}
            />
          </>
        )}

        <div className="field">
          <label htmlFor="pace">Pace groups</label>
          <input
            id="pace"
            value={paceGroups}
            onChange={(e) => setPaceGroups(e.target.value)}
            placeholder="easy, steady, quick"
          />
          <div className="hint">Comma separated.</div>
        </div>

        <div className="inline">
          <button className="primary" onClick={save} disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>

          {run?.status === 'draft' && (
            <button onClick={publish} disabled={busy}>
              Publish
            </button>
          )}

          {run && ['draft', 'published', 'in_progress'].includes(run.status) && (
            <button className="danger" onClick={cancel} disabled={busy}>
              Cancel run
            </button>
          )}
        </div>

        {run?.status === 'draft' && (
          <p className="hint" style={{ marginTop: 12 }}>
            This run is a draft — members cannot see it yet. Publishing notifies everyone and
            schedules the reminders.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * `datetime-local` has no timezone, and the browser interprets it in the
 * organiser's local zone. The club's timezone is what matters, so these convert
 * explicitly instead of relying on wherever the laptop happens to be.
 */
function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function fromLocalInput(local: string): string {
  // Find the UTC instant whose club-timezone rendering equals the typed text.
  const guess = new Date(`${local}:00Z`);
  const rendered = toLocalInput(guess.toISOString());
  const drift = new Date(`${local}:00Z`).getTime() - new Date(`${rendered}:00Z`).getTime();
  return new Date(guess.getTime() + drift).toISOString();
}
