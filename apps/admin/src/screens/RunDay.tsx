import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  formatRunDate,
  formatRunTime,
  toMemberMessage,
  type Run,
  type RunCounts,
  type AttendanceState,
  type CheckInMethod,
} from '@mvmnt/shared';
import { useToast } from '../components/Toast';
import { MemberDetail } from '../components/MemberDetail';

type Attendee = {
  id: string;
  user_id: string | null;
  state: AttendanceState;
  check_in_method: CheckInMethod | null;
  queued_at: string;
  display_name: string;
};

/**
 * Run day.
 *
 * The organiser's screen at the meeting point: who is here, who is expected,
 * and a one-tap way to check in anyone the geofence let down. ADR 0002 §3 makes
 * this the primary mitigation for check-in's real failure mode — a member who
 * turned up but whose phone did not cooperate.
 */
export function RunDay({ runId, onBack }: { runId: string; onBack: () => void }) {
  const toast = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const [counts, setCounts] = useState<RunCounts | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [moderating, setModerating] = useState<Attendee | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const [{ data: runRow }, { data: countRow }, { data: rows }] = await Promise.all([
      supabase.from('runs').select('*').eq('id', runId).maybeSingle(),
      supabase.from('run_attendance_counts').select('*').eq('run_id', runId).maybeSingle(),
      supabase
        .from('run_attendance_view')
        .select('id, user_id, state, check_in_method, queued_at, profiles(display_name)')
        .eq('run_id', runId)
        .order('queued_at', { ascending: true }),
    ]);

    setRun(runRow ?? null);
    setCounts(countRow ?? null);
    setAttendees(
      (rows ?? []).map((r) => {
        const profile = r.profiles as unknown as { display_name: string } | null;
        return {
          id: r.id as string,
          user_id: r.user_id as string | null,
          state: r.state as AttendanceState,
          check_in_method: r.check_in_method as CheckInMethod | null,
          queued_at: r.queued_at as string,
          // A member who has erased their account leaves an anonymised row —
          // the attendance still counts, but there is nobody to name.
          display_name: profile?.display_name ?? 'Former member',
        };
      }),
    );
    setLoading(false);
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  async function checkIn(attendee: Attendee) {
    if (!attendee.user_id) return;
    setBusyId(attendee.id);
    setError(null);

    const { error: rpcError } = await supabase.rpc('admin_check_in', {
      p_run_id: runId,
      p_user_id: attendee.user_id,
    });
    setBusyId(null);

    if (rpcError) {
      toast.error("Couldn't check them in", toMemberMessage(rpcError));
      return;
    }
    toast.success(`${attendee.display_name} is in`);
    await load();
  }

  async function removeCheckIn(attendee: Attendee) {
    if (!attendee.user_id) return;
    setBusyId(attendee.id);
    setError(null);

    const { error: rpcError } = await supabase.rpc('admin_remove_check_in', {
      p_run_id: runId,
      p_user_id: attendee.user_id,
    });
    setBusyId(null);

    if (rpcError) {
      toast.error("Couldn't undo that", toMemberMessage(rpcError));
      return;
    }
    toast.info(`${attendee.display_name}'s check-in removed`);
    await load();
  }

  async function lifecycle(action: 'start_run' | 'end_run') {
    setError(null);
    const { error: rpcError } = await supabase.rpc(action, { p_run_id: runId });
    if (rpcError) {
      toast.error("That didn't work", toMemberMessage(rpcError));
      return;
    }
    if (action === 'start_run') toast.success('Run started', 'Everyone signed up has been told.');
    else toast.success('Run ended', 'Everyone who checked in gets the wrap-up.');
    await load();
  }

  if (loading) return <p>Loading…</p>;
  if (!run) return <p>Run not found.</p>;

  const visible = attendees.filter((a) =>
    a.display_name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <>
      <button className="link" onClick={onBack} style={{ marginBottom: 12 }}>
        ← All runs
      </button>

      <div className="row">
        <div>
          <h2>{run.title}</h2>
          <p className="subtitle" style={{ margin: 0 }}>
            {formatRunDate(run.starts_at)} · {formatRunTime(run.starts_at)} ·{' '}
            {run.meeting_point_name}
          </p>
        </div>
        <span className={`pill ${run.status}`}>{run.status.replace('_', ' ')}</span>
      </div>

      {error && <div className="notice error" style={{ marginTop: 14 }}>{error}</div>}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row">
          <div className="stats">
            <div>
              <div className="stat">{counts?.checked_in_count ?? 0}</div>
              <div className="stat-label">Checked in</div>
            </div>
            <div>
              <div className="stat">{counts?.going_count ?? 0}</div>
              <div className="stat-label">Expected</div>
            </div>
            {(counts?.waitlist_count ?? 0) > 0 && (
              <div>
                <div className="stat">{counts?.waitlist_count}</div>
                <div className="stat-label">Waitlist</div>
              </div>
            )}
          </div>
          <div className="inline">
            {run.status === 'published' && (
              <button onClick={() => lifecycle('start_run')}>Start run</button>
            )}
            {(run.status === 'published' || run.status === 'in_progress') && (
              <button onClick={() => lifecycle('end_run')}>End run</button>
            )}
            <button onClick={load}>Refresh</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="filter">Find someone</label>
          <input
            id="filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Start typing a name"
          />
          <div className="hint">
            If someone is here but the app would not check them in — no signal, no location
            permission, phone in a bag — check them in yourself.
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            {attendees.length === 0 ? 'Nobody has signed up yet.' : 'Nobody matches that name.'}
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>How</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id}>
                    <td>{a.display_name}</td>
                    <td>
                      <span className={`pill ${a.state === 'checked_in' ? 'published' : ''}`}>
                        {a.state === 'checked_in'
                          ? 'In'
                          : a.state === 'signed_up'
                            ? 'Expected'
                            : a.state === 'waitlisted'
                              ? 'Waitlist'
                              : 'Withdrawn'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {a.check_in_method === 'admin'
                        ? 'By organiser'
                        : a.check_in_method === 'geofence'
                          ? 'At the meeting point'
                          : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="link"
                        onClick={() => setModerating(moderating?.id === a.id ? null : a)}
                        disabled={!a.user_id}
                        style={{ marginRight: 4 }}
                      >
                        {moderating?.id === a.id ? 'Close' : 'Manage'}
                      </button>
                      {a.state === 'checked_in' ? (
                        <button
                          className="link"
                          onClick={() => removeCheckIn(a)}
                          disabled={busyId === a.id || !a.user_id}
                        >
                          Undo
                        </button>
                      ) : (
                        <button
                          className="primary"
                          onClick={() => checkIn(a)}
                          disabled={busyId === a.id || !a.user_id}
                        >
                          {busyId === a.id ? '…' : 'Check in'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {moderating?.user_id && (
        <MemberDetail
          userId={moderating.user_id}
          onChanged={load}
          onClose={() => setModerating(null)}
        />
      )}
    </>
  );
}
