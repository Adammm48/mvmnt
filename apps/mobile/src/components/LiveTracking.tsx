import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Switch, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { getCurrentFix } from '@/lib/location';
import { RouteMap, type LiveDot } from '@/components/RouteMap';
import { colors, radius, spacing, toMemberMessage, type Run } from '@mvmnt/shared';

/** How often positions are pushed and pulled while the screen is open. */
const POLL_MS = 10_000;
/** Older than this and a dot is drawn dimmed rather than confident. */
const STALE_MS = 30_000;

/**
 * Live location during a run — the whole of ADR 0004's client side.
 *
 * Foreground-only by construction: everything hangs off a timer in this
 * component, so backgrounding the app (or leaving the screen) stops both
 * sharing and refreshing. There is no background task to audit because there
 * is no background task.
 *
 * The server owns every rule. This component's toggle is a convenience;
 * whether a position lands, and who sees whose dots, is decided by RLS and
 * the share_live_position() gate.
 */
export function LiveTracking({ run, checkedIn }: { run: Run; checkedIn: boolean }) {
  const { session } = useAuth();
  const [sharing, setSharing] = useState(false);
  const [dots, setDots] = useState<LiveDot[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const sharingRef = useRef(sharing);
  sharingRef.current = sharing;

  // Friends' names, once — live rows carry only ids, and asking per poll
  // would be sixty requests an hour for data that changes never.
  useEffect(() => {
    supabase.rpc('my_friends').then(({ data }) => {
      if (!data) return;
      const map: Record<string, string> = {};
      for (const f of data) map[f.friend_id] = f.display_name;
      setNames(map);
    });
  }, []);

  const tick = useCallback(async () => {
    // Foreground-only, literally: a backgrounded app skips the beat.
    if (AppState.currentState !== 'active') return;

    if (sharingRef.current) {
      const fix = await getCurrentFix();
      if (fix.ok) {
        const { error: shareError } = await supabase.rpc('share_live_position', {
          p_run_id: run.id,
          p_lat: fix.fix.latitude,
          p_lng: fix.fix.longitude,
        });
        // The run ending mid-share is normal, not an error worth shouting
        // about — flip the toggle off and let the screen's state catch up.
        if (shareError) setSharing(false);
      } else {
        setError(fix.message);
        setSharing(false);
      }
    }

    // Read regardless of whether we share: watching friends does not require
    // being watchable. RLS trims this to self + friends (+ all, for
    // organisers) — the client never sees a row it should not.
    const { data } = await supabase
      .from('live_positions')
      .select('*')
      .eq('run_id', run.id);
    if (data) {
      const now = Date.now();
      setDots(
        data.map((row) => ({
          id: row.user_id,
          label:
            row.user_id === session?.user.id
              ? 'You'
              : (names[row.user_id]?.split(' ')[0] ?? 'Runner'),
          lat: row.lat,
          lng: row.lng,
          stale: now - new Date(row.updated_at).getTime() > STALE_MS,
        })),
      );
    }
  }, [run.id, names, session?.user.id]);

  useEffect(() => {
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(timer);
  }, [tick]);

  // Leaving the screen while sharing stops sharing — the toggle promises
  // "while you're here", and a dot that outlives the screen breaks it.
  // (The server's two-minute staleness purge is the backstop, not the plan.)
  useEffect(() => {
    return () => {
      if (sharingRef.current) {
        void supabase.rpc('stop_sharing_live_position', { p_run_id: run.id });
      }
    };
  }, [run.id]);

  async function toggle(next: boolean) {
    setError(null);
    if (!next) {
      setSharing(false);
      const { error: stopError } = await supabase.rpc('stop_sharing_live_position', {
        p_run_id: run.id,
      });
      if (stopError) setError(toMemberMessage(stopError));
      setDots((d) => d.filter((dot) => dot.id !== session?.user.id));
      return;
    }

    // Prove a position lands before showing the switch as on — a toggle that
    // flips on and silently fails is the silent-failure bug all over again.
    const fix = await getCurrentFix();
    if (!fix.ok) {
      setError(fix.message);
      return;
    }
    const { error: shareError } = await supabase.rpc('share_live_position', {
      p_run_id: run.id,
      p_lat: fix.fix.latitude,
      p_lng: fix.fix.longitude,
    });
    if (shareError) {
      setError(toMemberMessage(shareError));
      return;
    }
    setSharing(true);
    void tick();
  }

  const friendDots = dots.filter((d) => d.id !== session?.user.id);
  const route = (run.route as [number, number][] | null) ?? null;

  return (
    <View style={styles.wrap}>
      {route && route.length >= 2 && run.route_published_at ? (
        <RouteMap route={route} distanceMeters={run.distance_meters} live={dots} />
      ) : (
        friendDots.length > 0 && (
          <View style={styles.list}>
            {friendDots.map((d) => (
              <Text key={d.id} style={styles.listRow}>
                {d.label} is out on the run{d.stale ? ' · a little while ago' : ''}
              </Text>
            ))}
          </View>
        )
      )}

      {checkedIn && (
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleLabel}>Share my live location</Text>
            <Text style={styles.toggleHint}>
              {sharing
                ? 'Your friends can see you on the route while this screen is open.'
                : 'Off. Only your friends would see you, and only until the run ends.'}
            </Text>
          </View>
          <Switch
            value={sharing}
            onValueChange={toggle}
            trackColor={{ true: colors.action, false: colors.baseElevated }}
            accessibilityLabel="Share my live location with my friends during this run"
          />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { color: colors.textOnDark, fontSize: 15, fontWeight: '600' },
  toggleHint: { color: colors.textOnDarkMuted, fontSize: 12, lineHeight: 16 },
  list: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  listRow: { color: colors.textOnDark, fontSize: 14 },
  error: { color: colors.alert, fontSize: 13 },
});
