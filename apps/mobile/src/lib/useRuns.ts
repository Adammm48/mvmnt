import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Run, RunCounts, AttendanceState } from '@mvmnt/shared';

export type RunListItem = {
  run: Run;
  counts: RunCounts | null;
  myState: AttendanceState | null;
};

/**
 * The home screen's data.
 *
 * Three queries rather than one join, because they have different visibility
 * rules: runs and counts are readable by everyone, attendance is readable only
 * for yourself. Trying to join them server-side would either leak other
 * members' attendance or need a bespoke view — see the RLS notes in
 * migration 0010.
 *
 * Three round trips is acceptable here: this screen loads a handful of upcoming
 * runs, not a feed (Principles §6).
 */
export function useRuns(userId: string | undefined) {
  const [items, setItems] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      setError(null);

      // Runs that already ended more than a day ago are not interesting on the
      // home screen; recent ones stay so a member can find yesterday's run.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: runs, error: runsError } = await supabase
        .from('runs')
        .select('*')
        .gte('starts_at', since)
        .order('starts_at', { ascending: true });

      if (runsError) {
        setError(runsError.message);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const runIds = (runs ?? []).map((r) => r.id);
      if (runIds.length === 0) {
        setItems([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const [{ data: counts }, { data: mine }] = await Promise.all([
        supabase.from('run_attendance_counts').select('*').in('run_id', runIds),
        userId
          ? supabase
              .from('run_attendance_view')
              .select('run_id, state')
              .in('run_id', runIds)
              .eq('user_id', userId)
          : Promise.resolve({ data: [] as { run_id: string; state: AttendanceState }[] }),
      ]);

      const countsByRun = new Map((counts ?? []).map((c) => [c.run_id, c]));
      const stateByRun = new Map(
        (mine ?? []).map((m) => [m.run_id as string, m.state as AttendanceState]),
      );

      setItems(
        (runs ?? []).map((run) => ({
          run,
          counts: countsByRun.get(run.id) ?? null,
          myState: stateByRun.get(run.id) ?? null,
        })),
      );
      setLoading(false);
      setRefreshing(false);
    },
    [userId],
  );

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, refreshing, error, reload: load };
}
