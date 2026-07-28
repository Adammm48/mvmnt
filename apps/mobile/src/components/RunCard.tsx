import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { CoverFallback } from './CoverFallback';
import {
  colors,
  radius,
  spacing,
  formatRunDate,
  formatRunTime,
  formatDistance,
  formatCapacityStatus,
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

/**
 * The run card carries the decision to join: a photo of the place, the time
 * in warm coral, and — deliberately — no numbers about who else is coming.
 *
 * Product decision, overriding App Spec §2's original social-proof design
 * ("312 people are already in"): members never see how many have joined or
 * how many places are left. See formatCapacityStatus().
 */
export function RunCard({ run, counts, myState, onPress }: Props) {
  const distance = formatDistance(run.distance_meters);
  const cancelled = run.status === 'cancelled';
  const capacityStatus = formatCapacityStatus(run, counts);

  const a11yLabel = [
    run.title,
    `${formatRunDate(run.starts_at)} at ${formatRunTime(run.starts_at)}`,
    run.meeting_point_name,
    distance ?? '',
    capacityStatus ?? '',
    myState ? statusText(myState) : '',
  ]
    .filter(Boolean)
    .join('. ');

  const body = (
    <>
      {/* Scrim: the cover photo is arbitrary, so text legibility cannot depend
          on it being dark in the right places (Principles §5). */}
      <View style={styles.scrim} />

      <View style={styles.topRow}>
        <View style={styles.datePill}>
          <Text style={styles.dateText}>
            {formatRunDate(run.starts_at)} · {formatRunTime(run.starts_at)}
          </Text>
        </View>
        {myState && <StatusPill state={myState} />}
      </View>

      <View style={styles.bottom}>
        <Text style={styles.title} numberOfLines={2}>
          {run.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {run.meeting_point_name}
          {distance ? ` · ${distance}` : ''}
        </Text>

        {cancelled ? (
          <Text style={styles.cancelled}>
            Cancelled{run.cancellation_reason ? ` — ${run.cancellation_reason}` : ''}
          </Text>
        ) : (
          // Unlimited capacity (the common case) has no scarcity to signal, so
          // nothing renders here at all — no count, no filler line.
          capacityStatus && (
            <View style={styles.attendanceRow}>
              <View
                style={[
                  styles.dot,
                  capacityStatus === 'Waitlist open' && styles.dotWaitlist,
                ]}
              />
              <Text style={styles.attendance}>{capacityStatus}</Text>
            </View>
          )
        )}
      </View>
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Opens the run details"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {run.cover_image_url ? (
        <ImageBackground
          source={{ uri: run.cover_image_url }}
          style={styles.media}
          imageStyle={styles.mediaImage}
        >
          {body}
        </ImageBackground>
      ) : (
        // No cover yet: a gradient keyed to this run rather than a flat panel
        // the same colour as the page, which reads as a broken image.
        <CoverFallback seed={run.id} style={styles.media}>
          {body}
        </CoverFallback>
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

  // Green means confirmed — a completed check-in, not an intention (App Spec §2).
  const confirmed = state === 'checked_in';

  return (
    <View style={[styles.pill, confirmed ? styles.pillConfirmed : styles.pillPending]}>
      <Text style={[styles.pillText, confirmed && styles.pillTextConfirmed]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.baseElevated,
  },
  pressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  media: { height: 220, justifyContent: 'space-between' },
  mediaImage: { borderRadius: radius.lg },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(12,14,20,0.42)' },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: spacing.md,
  },
  datePill: {
    backgroundColor: colors.action,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  dateText: { fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.4 },
  bottom: { padding: spacing.md, gap: 2 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.4,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 8,
  },
  meta: { fontSize: 14, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  attendanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  dotWaitlist: { backgroundColor: colors.highlight },
  attendance: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cancelled: { fontSize: 14, fontWeight: '700', color: '#FF9E93', marginTop: spacing.xs },
  pill: { paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.pill },
  pillConfirmed: { backgroundColor: colors.success },
  pillPending: { backgroundColor: 'rgba(255,255,255,0.22)' },
  pillText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  pillTextConfirmed: { color: colors.base },
});
