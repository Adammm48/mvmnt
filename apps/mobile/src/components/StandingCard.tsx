import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  describeGapToNextRank,
  describeRank,
  describeStreakShort,
  describeTierProgress,
  tierProgressFraction,
  TIER_COLOR,
  TIER_LABEL,
  type Standing,
} from '@mvmnt/shared';

/**
 * A member's own standing.
 *
 * Shown above the board and again on the profile, because the number that
 * matters most to a member is their own — and because this card works for
 * everyone, including the members outside the top 100 and the ones who have
 * opted out of appearing publicly. Without it the whole feature would speak
 * only to the visible third of the club.
 */
export function StandingCard({
  standing,
  /**
   * The all-time standing, passed only when `standing` is windowed.
   *
   * Tier, badges progress, runs and streak are lifetime facts — there is no
   * such thing as a monthly tier. Without this the month view headlined 90
   * points directly above "100 points to Core", two true numbers that read as
   * one false one.
   */
  lifetime,
}: {
  standing: Standing;
  lifetime?: Standing;
}) {
  const base = lifetime ?? standing;
  const windowed = lifetime !== undefined;
  const tier = base.tier;
  const fraction = tierProgressFraction(base.points_to_next_tier);
  const gap = describeGapToNextRank(standing.points_to_next_rank);

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.topRow}>
        <View>
          <Text style={styles.points}>{standing.points.toLocaleString()}</Text>
          <Text style={styles.pointsLabel}>{windowed ? 'points this month' : 'points'}</Text>
        </View>
        <View style={[styles.tierPill, { borderColor: TIER_COLOR[tier] }]}>
          <Text style={[styles.tierText, { color: TIER_COLOR[tier] }]}>{TIER_LABEL[tier]}</Text>
        </View>
      </View>

      <View style={styles.track} accessibilityRole="progressbar">
        <View
          style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: TIER_COLOR[tier] }]}
        />
      </View>
      <Text style={styles.progressText}>
        {windowed ? `${base.points.toLocaleString()} all time · ` : ''}
        {describeTierProgress(tier, base.points_to_next_tier)}
      </Text>

      <View style={styles.statRow}>
        <Stat value={describeRank(standing)} label={windowed ? 'this month' : 'on the board'} />
        <Stat value={`${base.runs_attended}`} label={base.runs_attended === 1 ? 'run' : 'runs'} />
        <Stat value={describeStreakShort(base.streak_weeks)} label="streak" />
      </View>

      {gap && <Text style={styles.gap}>{gap}</Text>}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  points: { ...typography.dataLarge, fontSize: 40, color: colors.textOnDark },
  pointsLabel: { fontSize: 13, color: colors.textOnDarkMuted, marginTop: -4 },
  tierPill: {
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  tierText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: '#333B4D',
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  fill: { height: '100%', borderRadius: radius.pill },
  progressText: { fontSize: 14, color: colors.textOnDarkMuted },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#333B4D',
    paddingTop: spacing.md,
  },
  stat: { flex: 1, gap: 2 },
  statValue: { ...typography.data, color: colors.textOnDark },
  statLabel: { fontSize: 12, color: colors.textOnDarkMuted },
  gap: { fontSize: 13, color: colors.highlight, marginTop: spacing.xs },
});
