import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CLUB_TIMEZONE, toMemberMessage, type Run } from '@mvmnt/shared';
import { MediaUpload } from '../components/MediaUpload';
import { MeetingPointPicker } from '../components/MeetingPointPicker';
import { useToast } from '../components/Toast';

type Props = { runId: string | null; onDone: () => void };

// Cairo city centre — a sensible starting pin for a new run.
const DEFAULT_LAT = 30.0444;
const DEFAULT_LNG = 31.2357;

/**
 * Create and edit a run.
 *
 * Publishing is a separate, explicit act rather than a side effect of saving:
 * publish_run() announces the run to every member and schedules both reminders,
 * so it must not be something an organiser triggers by accident while fixing a
 * typo.
 */
export function RunEditor({ runId, onDone }: Props) {
  const toast = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(runId !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Date and time are separate fields. A combined datetime-local is one fiddly
  // control where the date half is easy to leave wrong without noticing — which
  // is exactly how a run got created ten days in the past.
  const [date, setDate] = useState('');
  const [time, setTime] = useState('07:00');
  const [endTime, setEndTime] = useState('');
  const [meetingPoint, setMeetingPoint] = useState('');
  const [lat, setLat] = useState(DEFAULT_LAT);
  const [lng, setLng] = useState(DEFAULT_LNG);
  const [radius, setRadius] = useState(250);
  const [distance, setDistance] = useState('');
  const [capacity, setCapacity] = useState('');
  const [paceGroups, setPaceGroups] = useState('');

  useEffect(() => {
    if (!runId) return;
    supabase
      .from('runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) applyRun(data);
        setLoading(false);
      });
  }, [runId]);

  function applyRun(data: Run) {
    setRun(data);
    setTitle(data.title);
    setDescription(data.description ?? '');
    const start = splitClubDateTime(data.starts_at);
    setDate(start.date);
    setTime(start.time);
    setEndTime(data.ends_at ? splitClubDateTime(data.ends_at).time : '');
    setMeetingPoint(data.meeting_point_name);
    setLat(data.meeting_point_lat);
    setLng(data.meeting_point_lng);
    setRadius(data.check_in_radius_m);
    setDistance(data.distance_meters ? String(data.distance_meters) : '');
    setCapacity(data.capacity ? String(data.capacity) : '');
    setPaceGroups(data.pace_groups.join(', '));
  }

  async function reload() {
    const id = run?.id ?? runId;
    if (!id) return;
    const { data } = await supabase.from('runs').select('*').eq('id', id).maybeSingle();
    if (data) setRun(data);
  }

  // --- validation, surfaced before anything is attempted ------------------
  const startsAtIso = date && time ? clubTimeToIso(date, time) : null;
  const startsInPast = startsAtIso !== null && new Date(startsAtIso) <= new Date();
  const problems: string[] = [];
  if (!title.trim()) problems.push('Give the run a title.');
  if (!date) problems.push('Pick a date.');
  if (!time) problems.push('Pick a start time.');
  if (!meetingPoint.trim()) problems.push('Name the meeting point.');
  if (startsInPast) problems.push('That date and time have already passed — pick a future one.');

  const canSave = problems.length === 0;

  async function save() {
    setBusy(true);
    setError(null);

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      starts_at: clubTimeToIso(date, time),
      ends_at: endTime ? clubTimeToIso(date, endTime) : null,
      meeting_point_name: meetingPoint.trim(),
      meeting_point_lat: lat,
      meeting_point_lng: lng,
      check_in_radius_m: radius,
      distance_meters: distance ? Number(distance) : null,
      capacity: capacity ? Number(capacity) : null,
      pace_groups: paceGroups.split(',').map((p) => p.trim()).filter(Boolean),
    };

    const id = run?.id ?? runId;
    const result = id
      ? await supabase.from('runs').update(payload).eq('id', id).select().maybeSingle()
      : await supabase.from('runs').insert(payload).select().maybeSingle();

    setBusy(false);
    if (result.error) {
      setError(toMemberMessage(result.error));
      return;
    }
    if (result.data) applyRun(result.data);
    if (id) toast.success('Changes saved');
    else toast.success('Draft saved', "Members can't see it until you publish.");
  }

  async function publish() {
    if (!run) return;
    setBusy(true);
    setError(null);
    const { error: publishError } = await supabase.rpc('publish_run', { p_run_id: run.id });
    setBusy(false);
    if (publishError) {
      // Surfaced as a toast as well as inline: a refused publish must never
      // look like nothing happening, which is exactly how it failed before.
      toast.error("Couldn't publish", toMemberMessage(publishError));
      setError(toMemberMessage(publishError));
      return;
    }
    toast.success(
      `${run.title} is live`,
      'Every member has been notified. Both reminders are scheduled.',
    );
    await reload();
  }

  async function cancel() {
    if (!run) return;
    const reason = window.prompt('Why is it cancelled? Members will see this.', 'Weather');
    if (reason === null) return;
    setBusy(true);
    setError(null);
    const { error: cancelError } = await supabase.rpc('cancel_run', {
      p_run_id: run.id,
      p_reason: reason || undefined,
    });
    setBusy(false);
    if (cancelError) {
      toast.error("Couldn't cancel", toMemberMessage(cancelError));
      return;
    }
    toast.info('Run cancelled', 'Pending reminders for it have been cancelled too.');
    await reload();
  }

  if (loading) return <p>Loading…</p>;

  const isDraft = run === null || run.status === 'draft';

  return (
    <>
      <button className="link back" onClick={onDone}>
        ← All runs
      </button>

      <div className="page-head">
        <div>
          <h2>{run ? run.title || 'Edit run' : 'New run'}</h2>
          <p className="subtitle">
            All times are {CLUB_TIMEZONE.split('/')[1]?.replace('_', ' ')} time — the same times
            members see.
          </p>
        </div>
        {run && <span className={`pill ${run.status}`}>{run.status.replace('_', ' ')}</span>}
      </div>

      {error && <div className="notice error">{error}</div>}

      <section className="card">
        <h3 className="section-title">The basics</h3>

        <div className="field">
          <label htmlFor="title">What's it called?</label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Saturday 6K"
          />
        </div>

        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Our weekly 6K. All paces welcome — nobody gets left behind."
          />
          <div className="hint">Shown on the run page. A friendly line or two.</div>
        </div>
      </section>

      <section className="card">
        <h3 className="section-title">When</h3>

        <div className="grid3">
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="time">Start time</label>
            <input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="endTime">Finish time</label>
            <input
              id="endTime"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
            <div className="hint">Optional.</div>
          </div>
        </div>

        {startsAtIso && !startsInPast && (
          <div className="notice info">
            <strong>{describeStart(startsAtIso)}</strong>
            <br />
            Check-in opens an hour before, at {addMinutes(time, -60)}.
          </div>
        )}
        {startsInPast && (
          <div className="notice error">
            That date and time have already passed. A run has to start in the future before it can
            be published.
          </div>
        )}
      </section>

      <section className="card">
        <h3 className="section-title">Where</h3>

        <div className="field">
          <label htmlFor="meeting">Meeting point name</label>
          <input
            id="meeting"
            value={meetingPoint}
            onChange={(e) => setMeetingPoint(e.target.value)}
            placeholder="Zamalek Club Gate"
          />
          <div className="hint">What members will read. Somewhere easy to find.</div>
        </div>

        <MeetingPointPicker
          lat={lat}
          lng={lng}
          radiusM={radius}
          onChange={(nextLat, nextLng) => {
            setLat(nextLat);
            setLng(nextLng);
          }}
        />

        <div className="field">
          <label htmlFor="radius">Check-in area: {radius}m across</label>
          <input
            id="radius"
            type="range"
            min={50}
            max={1000}
            step={25}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
          <div className="hint">
            250m suits a normal run. Widen it for a big event where the crowd spreads out.
          </div>
        </div>
      </section>

      <section className="card">
        <h3 className="section-title">The run itself</h3>

        <div className="grid2">
          <div className="field">
            <label htmlFor="distance">Distance</label>
            <div className="input-suffix">
              <input
                id="distance"
                type="number"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder="6000"
              />
              <span>metres</span>
            </div>
            <div className="hint">
              {distance ? `That's ${(Number(distance) / 1000).toFixed(1)}K` : 'Optional.'}
            </div>
          </div>

          <div className="field">
            <label htmlFor="capacity">Limit on numbers</label>
            <input
              id="capacity"
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="No limit"
            />
            <div className="hint">
              {capacity
                ? `After ${capacity} people, everyone else joins a waitlist and moves up automatically if someone drops out.`
                : 'Leave blank for unlimited — the usual choice.'}
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="pace">Pace groups</label>
          <input
            id="pace"
            value={paceGroups}
            onChange={(e) => setPaceGroups(e.target.value)}
            placeholder="easy, steady, quick"
          />
          <div className="hint">Separate with commas. Leave blank if you don't split by pace.</div>
        </div>
      </section>

      {run && (
        <section className="card">
          <h3 className="section-title">Photo &amp; video</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            This is what makes people want to tap join. A good photo of the spot goes a long way.
          </p>
          <MediaUpload
            runId={run.id}
            column="cover_image_url"
            label="Cover photo"
            accept="image/jpeg,image/png,image/webp"
            hint="Shown behind the run in the app. Landscape works best."
            currentUrl={run.cover_image_url}
            onChanged={reload}
          />
          <MediaUpload
            runId={run.id}
            column="cover_video_url"
            label="Cover clip (optional)"
            accept="video/mp4,video/quicktime"
            hint="A few seconds. It plays muted and on a loop, so it mustn't rely on sound."
            currentUrl={run.cover_video_url}
            onChanged={reload}
          />
        </section>
      )}

      {/*
        The action bar sticks to the bottom of the viewport, and any problem is
        stated right next to the button it blocks. Previously the error rendered
        at the top of a long form while Publish sat at the bottom — so a refused
        publish looked to the organiser like nothing happening at all.
      */}
      <div className="action-bar">
        {problems.length > 0 && (
          <div className="action-problems">
            {problems.map((p) => (
              <div key={p}>• {p}</div>
            ))}
          </div>
        )}

        <div className="inline">
          <button className="primary" onClick={save} disabled={busy || !canSave}>
            {busy ? 'Saving…' : run ? 'Save changes' : 'Save draft'}
          </button>

          {run && isDraft && (
            <button onClick={publish} disabled={busy || !canSave}>
              Publish &amp; notify everyone
            </button>
          )}

          {run && ['draft', 'published', 'in_progress'].includes(run.status) && (
            <button className="danger" onClick={cancel} disabled={busy}>
              Cancel run
            </button>
          )}

          <button className="link" onClick={onDone}>
            Done
          </button>
        </div>

        {run && isDraft && (
          <p className="hint" style={{ margin: '8px 0 0' }}>
            This is a draft — members can't see it yet.
          </p>
        )}
      </div>
    </>
  );
}

// --- club-timezone helpers -----------------------------------------------
//
// The browser's `date` and `time` inputs carry no timezone. The club's timezone
// is what matters, so these convert explicitly rather than relying on wherever
// the organiser's laptop happens to be.

function clubOffsetMinutes(at: Date): number {
  // Compare the same instant rendered in UTC and in the club's zone.
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  const club = new Date(at.toLocaleString('en-US', { timeZone: CLUB_TIMEZONE }));
  return Math.round((club.getTime() - utc.getTime()) / 60000);
}

function clubTimeToIso(date: string, time: string): string {
  const naive = new Date(`${date}T${time}:00Z`);
  // The offset is computed at the target instant, so a daylight-saving change
  // is handled rather than assumed away.
  const offset = clubOffsetMinutes(naive);
  return new Date(naive.getTime() - offset * 60000).toISOString();
}

function splitClubDateTime(iso: string): { date: string; time: string } {
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
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

function describeStart(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: CLUB_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function addMinutes(time: string, delta: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = ((h ?? 0) * 60 + (m ?? 0) + delta + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
