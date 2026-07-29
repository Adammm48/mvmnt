import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/Button';
import { Loading, Notice } from '@/components/Feedback';
import { RunHero } from '@/components/RunHero';
import { Celebration } from '@/components/Celebration';
import { RouteMap } from '@/components/RouteMap';
import { LiveTracking } from '@/components/LiveTracking';
import { getCurrentFix } from '@/lib/location';
import { enqueue, hasPendingFor, removePendingFor } from '@/lib/checkInQueue';
import {
  adamSays,
  colors,
  radius,
  spacing,
  formatRunDate,
  formatRunTime,
  formatDistance,
  formatCapacityStatus,
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
  const router = useRouter();

  const [run, setRun] = useState<Run | null>(null);
  const [counts, setCounts] = useState<RunCounts | null>(null);
  const [myState, setMyState] = useState<AttendanceState | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);

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
    // "You're in!" must not keep celebrating above "You're out" (audit).
    setCelebrate(null);

    const { error: withdrawError } = await supabase.rpc('withdraw_from_run', { p_run_id: id });
    setBusy(false);

    if (withdrawError) {
      setError(toMemberMessage(withdrawError));
      return;
    }

    // Drop any check-in queued while offline. Without this it replays on the
    // next foreground and quietly checks the member back into the run they
    // just pulled out of.
    await removePendingFor(id);
    setQueuedOffline(false);

    // Someone leaving the waitlist never held a place, so telling them they
    // freed one is simply untrue.
    setSuccess(
      myState === 'waitlisted'
        ? "You're off the waitlist."
        : "You're out. Your place is free for someone else.",
    );
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
        setCelebrate("You're checked in");
        setSuccess("We'll sync it as soon as you have signal.");
        return;
      }
      setError(toMemberMessage(checkInError));
      return;
    }

    setCelebrate("You're in!");
    await load();

    // Milestones ride the celebration they belong to. streak_new and
    // milestone_100 sat in the voice catalogue with zero call sites (audit
    // finding) while the data to fire them was already on this screen's
    // standing call — the moment after a check-in is exactly when "six weeks
    // straight" means something.
    const { data: after } = await supabase.rpc('my_standing', { p_window: 'all_time' });
    const standing = (after ?? [])[0];
    if (standing?.runs_attended === 100) {
      setSuccess(adamSays('milestone_100', { userId: session?.user.id }));
    } else if ((standing?.streak_weeks ?? 0) >= 2) {
      setSuccess(adamSays('streak_new', { userId: session?.user.id }));
    }
  }

  if (loading) return <Loading label="Loading run" />;

  if (!run) {
    // Reachable two ways: a genuinely missing/draft run (bad or stale link —
    // most often a local dev database that has been reset since the id was
    // captured, since every reset issues fresh ids), or an admin cancelling the
    // run out from under an open tab. Either way this must not be a dead end:
    // there is no guaranteed way back (a deep link has no navigation history),
    // so an explicit way home is required rather than relying on a back button.
    return (
      <View style={[styles.screen, styles.notFound]}>
        <Notice
          tone="error"
          message="This run isn't available anymore. It may have been removed, or the link is out of date."
        />
        <Text style={styles.voiceLine}>{adamSays('error_notfound', { noSurprises: true })}</Text>
        <Button label="Back to your runs" onPress={() => router.replace('/')} />
      </View>
    );
  }

  const distance = formatDistance(run.distance_meters);
  // No numbers shown to members — see formatCapacityStatus(). runIsFull below
  // still reads the real count, but only to decide a label ("join" vs "join
  // the waitlist"), never to render one.
  const capacityStatus = formatCapacityStatus(run, counts);
  const cancelled = run.status === 'cancelled';
  const checkInOpen = isCheckInWindowOpen(run);
  const alreadyIn = myState === 'checked_in' || queuedOffline;
  const attending = myState === 'signed_up' || myState === 'waitlisted';

  // Only a capped run can be full; capacity null means unlimited.
  const runIsFull =
    run.capacity !== null && (counts?.going_count ?? 0) >= run.capacity;

  // Mirrors withdraw_from_run()'s own rule (starts_at > now), so the button is
  // offered exactly when the server would accept it — never showing an action
  // that is going to be refused, and never hiding one that would succeed.
  const notStarted = new Date(run.starts_at) > new Date();
  const canWithdraw = notStarted && (attending || alreadyIn);
  const withdrawLabel =
    myState === 'waitlisted'
      ? 'Leave the waitlist'
      : alreadyIn
        ? "Actually, I can't make it"
        : "I can't make it";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <RunHero run={run} />

      <View style={styles.body}>
        {run.description ? <Text style={styles.description}>{run.description}</Text> : null}

      {celebrate && <Celebration message={celebrate} voice={`Adam says: ${adamSays('checked_in')}`} />}

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

      {/*
        Only once the organiser has published it. A route still being drawn is
        a draft, and showing it would have members planning around a shape that
        changes under them.
      */}
      {/*
        While the run is on, the route section becomes the live one: the same
        shape, with friends who chose to share drawn on it, and the opt-in
        toggle for whoever is checked in (ADR 0004). Before and after, it is
        the plain drawing.
      */}
      {run.status === 'in_progress' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Out on the run</Text>
          <LiveTracking run={run} checkedIn={myState === 'checked_in'} />
        </View>
      ) : (
        run.route &&
        run.route_published_at && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>The route</Text>
            <RouteMap
              route={run.route as [number, number][]}
              distanceMeters={run.distance_meters}
            />
          </View>
        )
      )}

      {/* Same rule as the route: nothing until the organiser publishes. */}
      {run.photos_published_at && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>The photos</Text>
          <Button
            label="See the photos"
            variant="secondary"
            onPress={() => router.push(`/photos/${run.id}`)}
            accessibilityHint="Opens this run's photo gallery"
          />
        </View>
      )}

      <View style={styles.social}>
        {capacityStatus && <Text style={styles.spots}>{capacityStatus}</Text>}
        <Text style={styles.yourStatus}>
          {queuedOffline ? "You're in — syncing" : describeAttendanceState(myState)}
        </Text>
      </View>

      {/*
        One primary action per screen (App Spec §2): check in on the day,
        otherwise join. Withdrawing is always secondary so it never competes
        with the encouraging action — but it must still be REACHABLE.

        App Spec §4.1 grants withdrawal "at any time before the run starts",
        which includes the hour when check-in is already open. Gating it on
        !checkInOpen stranded anyone who realised at 06:30 they could not make
        the 07:00 run: the server would have accepted the withdrawal, the
        screen simply never offered it. That matters most on a capped run,
        where the freed place should pass to someone on the waitlist.
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
            // Say which it is BEFORE the tap. Offering "Join this run" on a
            // full run and only revealing the waitlist afterwards is a small
            // bait-and-switch — the member should know what they are agreeing
            // to. The server still decides; this only reports what it will do.
            <Button
              label={runIsFull ? 'Join the waitlist' : 'Join this run'}
              onPress={join}
              loading={busy}
              accessibilityHint={
                runIsFull
                  ? 'This run is full. You will be added to the waitlist and moved up automatically if someone drops out.'
                  : undefined
              }
            />
          )}

          {canWithdraw && (
            <Button
              label={withdrawLabel}
              variant="secondary"
              onPress={withdraw}
              loading={busy}
              accessibilityHint="Frees your place so someone on the waitlist can take it"
            />
          )}

          {!checkInOpen && !isJoinable(run) && !attending && !alreadyIn && (
            <Text style={styles.closedNote}>
              {run.status === 'completed'
                ? 'This run has finished.'
                : 'Sign-up for this run has closed.'}
            </Text>
          )}

          {/* A finished run somebody was AT deserves a word. The run_finished
              lines sat in the catalogue with no call site. */}
          {run.status === 'completed' && alreadyIn && (
            <Text style={styles.voiceLine}>
              {adamSays('run_finished', { userId: session?.user.id, stability: 'daily' })}
            </Text>
          )}
          </View>
        )}
      </View>
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
  voiceLine: {
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  screen: { flex: 1, backgroundColor: colors.base },
  notFound: { justifyContent: 'center', padding: spacing.md, gap: spacing.md },
  content: { paddingBottom: spacing.xxl },
  body: { padding: spacing.md, gap: spacing.md },
  description: { fontSize: 16, color: colors.textOnDarkMuted, lineHeight: 23 },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnDark },
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
  spots: { fontSize: 15, color: colors.highlight, fontWeight: '700' },
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
