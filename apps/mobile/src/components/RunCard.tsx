import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  formatRunDate,
  formatRunTime,
  formatDistance,
  formatAttendance,
  type Run,
  type RunCounts,
  type AttendanceState,
} from '@mvmnt/shared';

type Props = {
  run: Run;
  counts: RunCounts | null;
  myState: AttendanceState | null;
  onPress: () => void;
};

export function RunCard({ run, counts, myState, onPress }: Props) {
  const distance = formatDistance(run.distance_meters);
  const cancelled = run.status === 'cancelled';

  // The whole card is one target with one label, so a screen reader announces
  // the run as a unit rather than reading five disconnected fragments.
  const a11yLabel = [
    run.title,
    `${formatRunDate(run.starts_at)} at ${formatRunTime(run.starts_at)}`,
    run.meeting_point_name,
    distance ?? '',
    formatAttendance(counts),
    myState ? statusText(myState) : '',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Opens the run details"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.date}>
          {formatRunDate(run.starts_at)} · {formatRunTime(run.starts_at)}
        </Text>
        {myState && <StatusPill state={myState} />}
      </View>

      <Text style={styles.title}>{run.title}</Text>

      <Text style={styles.meta}>
        {run.meeting_point_name}
        {distance ? ` · ${distance}` : ''}
      </Text>

      {cancelled ? (
        <Text style={styles.cancelled}>
          Cancelled{run.cancellation_reason ? ` — ${run.cancellation_reason}` : ''}
        </Text>
      ) : (
        <Text style={styles.attendance}>{formatAttendance(counts)}</Text>
      )}
    </Pressable>
  );
}

function statusText(state: AttendanceState): string {
  switch (state) {
    case 'checked_in':
      return "You're in";
    case 'signed_up':
      return 'Going';
    case 'waitlisted':
      return 'Waitlist';
    case 'withdrawn':
      return '';
  }
}

function StatusPill({ state }: { state: AttendanceState }) {
  const text = statusText(state);
  if (!text) return null;

  // Green is reserved for confirmation — a completed check-in, not an intention
  // to attend (App Spec §2).
  const confirmed = state === 'checked_in';

  return (
    <View style={[styles.pill, confirmed ? styles.pillConfirmed : styles.pillPending]}>
      <Text style={[styles.pillText, confirmed && styles.pillTextConfirmed]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  pressed: { opacity: 0.9 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 13, fontWeight: '600', color: colors.action, letterSpacing: 0.3 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  meta: { fontSize: 14, color: colors.textSecondary },
  attendance: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.xs },
  cancelled: { fontSize: 14, fontWeight: '600', color: colors.alert, marginTop: spacing.xs },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  pillConfirmed: { backgroundColor: colors.success },
  pillPending: { backgroundColor: colors.surfaceSunken },
  pillText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  pillTextConfirmed: { color: colors.base },
});
