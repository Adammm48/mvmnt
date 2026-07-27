import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/Button';
import { Loading, Notice } from '@/components/Feedback';
import { getCurrentFix } from '@/lib/location';
import { enqueue, hasPendingFor } from '@/lib/checkInQueue';
import {
  colors,
  radius,
  spacing,
  formatRunDate,
  formatRunTime,
  formatDistance,
  formatAttendance,
  formatSpotsLeft,
  describeAttendanceState,
  isCheckInWindowOpen,
  isJoinable,
  toMemberMessage,
  isOffline,
  type Run,
  type RunCounts,
  type AttendanceState,
} from '@mvmnt/shared';

export default function RunDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const navigation = useNavigation();

  const [run, setRun] = useState<Run | null>(null);
  const [counts, setCounts] = useState<RunCounts | null>(null);
  const [myState, setMyState] = useState<AttendanceState | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;

    const [{ data: runRow, error: runError }, { data: countRow }, { data: mine }] =
      await Promise.all([
        supabase.from('runs').select('*').eq('id', id).maybeSingle(),
        supabase.from('run_attendance_counts').select('*').eq('run_id', id).maybeSingle(),
        session
          ? supabase
              .from('run_attendance_view')
              .select('state')
              .eq('run_id', id)
              .eq('user_id', session.user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

    if (runError) setError(toMemberMessage(runError));
    setRun(runRow ?? null);
    setCounts(countRow ?? null);
    setMyState((mine?.state as AttendanceState | undefined) ?? null);
    setQueuedOffline(await hasPendingFor(id));
    setLoading(false);
  }, [id, session]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (run) navigation.setOptions({ title: run.title });
  }, [run, navigation]);

  async function join() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    const { data, error: joinError } = await supabase.rpc('join_run', { p_run_id: id });
    setBusy(false);

    if (joinError) {
      setError(toMemberMessage(joinError));
      return;
    }
    // The server decides whether this was a place or a waitlist spot; the app
    // reports what it was told rather than predicting it.
    setSuccess(
      data === 'waitlisted'
        ? "You're on the waitlist — we'll let you know the moment a spot opens."
        : "You're in. See you there.",
    );
    await load();
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    const { error: withdrawError } = await supabase.rpc('withdraw_from_run', { p_run_id: id });
    setBusy(false);

    if (withdrawError) {
      setError(toMemberMessage(withdrawError));
      return;
    }
    await load();
  }

  /**
   * Check in.
   *
   * The geofence prompts rather than deciding silently (ADR 0002 §1): the
   * member taps, and gets a receipt. The server re-validates the distance, so
   * the fix sent here is a claim, not a verdict.
   */
  async function checkIn() {
    if (!run) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    const outcome = await getCurrentFix();
    if (!outcome.ok) {
      setBusy(false);
      setError(outcome.message);
      return;
    }

    const { error: checkInError } = await supabase.rpc('check_in', {
      p_run_id: run.id,
      p_lat: outcome.fix.latitude,
      p_lng: outcome.fix.longitude,
      p_accuracy_m: outcome.fix.accuracy ?? undefined,
      p_client_ts: outcome.fix.capturedAt,
    });
    setBusy(false);

    if (checkInError) {
      // A dropped connection at a mass start is the expected case, not an edge
      // case. Queue it with the timestamp of the tap and confirm to the member
      // that they are done — replaying happens on the next foreground.
      if (isOffline(checkInError)) {
        await enqueue({ runId: run.id, fix: outcome.fix, queuedAt: new Date().toISOString() });
        setQueuedOffline(true);
        setSuccess("You're checked in. We'll sync it as soon as you have signal.");
        return;
      }
      setError(toMemberMessage(checkInError));
      return;
    }

    setSuccess("You're in. Have a good one.");
    await load();
  }

  if (loading) return <Loading label="Loading run" />;

  if (!run) {
    return (
      <View style={styles.screen}>
        <Notice tone="error" message="This run is not available." />
      </View>
    );
  }

  const distance = formatDistance(run.distance_meters);
  const spots = formatSpotsLeft(run, counts);
  const cancelled = run.status === 'cancelled';
  const checkInOpen = isCheckInWindowOpen(run);
  const alreadyIn = myState === 'checked_in' || queuedOffline;
  const attending = myState === 'signed_up' || myState === 'waitlisted';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.when}>
          {formatRunDate(run.starts_at)} · {formatRunTime(run.starts_at)}
        </Text>
        <Text style={styles.title}>{run.title}</Text>
        {run.description ? <Text style={styles.description}>{run.description}</Text> : null}
      </View>

      {cancelled && (
        <Notice
          tone="error"
          message={`This run has been cancelled${run.cancellation_reason ? `: ${run.cancellation_reason}` : '.'}`}
        />
      )}
      {error && <Notice tone="error" message={error} />}
      {success && <Notice tone="success" message={success} />}

      <View style={styles.factRow}>
        <Fact label="Meeting point" value={run.meeting_point_name} />
        {distance && <Fact label="Distance" value={distance} />}
      </View>

      {run.pace_groups.length > 0 && (
        <Fact label="Pace groups" value={run.pace_groups.join(' · ')} />
      )}

      <View style={styles.social}>
        <Text style={styles.socialCount}>{formatAttendance(counts)}</Text>
        {spots && <Text style={styles.spots}>{spots}</Text>}
        <Text style={styles.yourStatus}>
          {queuedOffline ? "You're in — syncing" : describeAttendanceState(myState)}
        </Text>
      </View>

      {/*
        One primary action per screen (App Spec §2). Which one it is depends on
        where the member is in the journey: check in on the day, otherwise join,
        otherwise nothing — withdrawing is deliberately secondary so it never
        competes with the encouraging action.
      */}
      {!cancelled && (
        <View style={styles.actions}>
          {checkInOpen && !alreadyIn && (
            <Button
              label="Check in"
              onPress={checkIn}
              loading={busy}
              accessibilityHint="Uses your location to confirm you are at the meeting point"
            />
          )}

          {checkInOpen && alreadyIn && (
            <View style={styles.checkedIn} accessibilityRole="summary">
              <Text style={styles.checkedInText}>You're checked in</Text>
            </View>
          )}

          {!checkInOpen && isJoinable(run) && !attending && (
            <Button label="Join this run" onPress={join} loading={busy} />
          )}

          {!checkInOpen && attending && (
            <Button
              label={myState === 'waitlisted' ? 'Leave the waitlist' : "I can't make it"}
              variant="secondary"
              onPress={withdraw}
              loading={busy}
            />
          )}

          {!checkInOpen && !isJoinable(run) && !attending && (
            <Text style={styles.closedNote}>
              {run.status === 'completed'
                ? 'This run has finished.'
                : 'Sign-up for this run has closed.'}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  hero: { gap: spacing.xs },
  when: { fontSize: 14, fontWeight: '700', color: colors.action, letterSpacing: 0.4 },
  title: { fontSize: 30, fontWeight: '800', color: colors.textOnDark },
  description: { fontSize: 16, color: colors.textOnDarkMuted, lineHeight: 23, marginTop: spacing.xs },
  factRow: { flexDirection: 'row', gap: spacing.md },
  fact: {
    flex: 1,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  factLabel: { fontSize: 12, color: colors.textOnDarkMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  factValue: { fontSize: 16, fontWeight: '600', color: colors.textOnDark },
  social: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  socialCount: { fontSize: 22, fontWeight: '800', color: colors.textOnDark, fontVariant: ['tabular-nums'] },
  spots: { fontSize: 14, color: colors.highlight, fontWeight: '600' },
  yourStatus: { fontSize: 14, color: colors.textOnDarkMuted },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  checkedIn: {
    backgroundColor: colors.success,
    borderRadius: radius.pill,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkedInText: { fontSize: 16, fontWeight: '800', color: colors.base },
  closedNote: { fontSize: 15, color: colors.textOnDarkMuted, textAlign: 'center' },
});
