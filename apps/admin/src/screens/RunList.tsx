import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { View } from '../App';
import {
  formatRunDate,
  formatRunTime,
  toMemberMessage,
  type Run,
  type RunCounts,
} from '@mvmnt/shared';

type Item = { run: Run; counts: RunCounts | null };

export function RunList({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // Admins see drafts too — that is an RLS decision, not a query filter.
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select('*')
      .order('starts_at', { ascending: false });

    if (runsError) {
      setError(toMemberMessage(runsError));
      setLoading(false);
      return;
    }

    const { data: counts } = await supabase.from('run_attendance_counts').select('*');
    const byRun = new Map((counts ?? []).map((c) => [c.run_id, c]));

    setItems((runs ?? []).map((run) => ({ run, counts: byRun.get(run.id) ?? null })));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p>Loading runs…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Runs</h2>
          <p className="subtitle">Create a run, publish it, and check people in on the day.</p>
        </div>
        <button className="primary" onClick={() => onNavigate({ name: 'editor', runId: null })}>
          New run
        </button>
      </div>

      {error && <div className="notice error">{error}</div>}

      {items.length === 0 ? (
        <div className="card empty">
          <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
            No runs yet
          </p>
          <p style={{ margin: 0 }}>Create the first one and the club will hear about it.</p>
        </div>
      ) : (
        items.map(({ run, counts }) => (
          <div className="card" key={run.id}>
            <div className="run-row">
              <div className="inline" style={{ flex: 1, minWidth: 240, alignItems: 'flex-start' }}>
                {run.cover_image_url ? (
                  <img className="run-thumb" src={run.cover_image_url} alt="" />
                ) : (
                  <div className="run-thumb" />
                )}
                <div>
                  <div className="inline" style={{ marginBottom: 2 }}>
                    <span className="run-title">{run.title}</span>
                    <span className={`pill ${run.status}`}>{run.status.replace('_', ' ')}</span>
                  </div>
                  <div className="run-when">
                    {formatRunDate(run.starts_at)} · {formatRunTime(run.starts_at)} ·{' '}
                    {run.meeting_point_name}
                  </div>
                  <div className="run-counts">
                    <strong>{counts?.going_count ?? 0}</strong> going
                    {run.capacity ? ` of ${run.capacity}` : ''}
                    {(counts?.checked_in_count ?? 0) > 0 && (
                      <> · <strong>{counts?.checked_in_count}</strong> checked in</>
                    )}
                    {(counts?.waitlist_count ?? 0) > 0 && (
                      <> · <strong>{counts?.waitlist_count}</strong> waiting</>
                    )}
                  </div>
                </div>
              </div>
              <div className="inline">
                <button onClick={() => onNavigate({ name: 'editor', runId: run.id })}>Edit</button>
                {run.status !== 'draft' && (
                  <button className="primary" onClick={() => onNavigate({ name: 'runday', runId: run.id })}>
                    Run day
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}
