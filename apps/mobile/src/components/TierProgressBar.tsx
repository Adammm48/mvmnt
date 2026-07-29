import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  tierProgressFraction,
  TIER_COLOR,
  TIER_LABEL,
  TIER_ORDER,
  type MemberTier,
} from '@mvmnt/shared';
import { TierBadge } from './TierBadge';

/**
 * How close you are to the next tier, with the badge you are working towards
 * sitting at the end of the bar.
 *
 * The badge is the point. A bar with a number at the end measures something; a
 * bar with the thing you get at the end of it is a reason to go out on a cold
 * Saturday. It renders locked — flat and grey — until it is earned, so the
 * difference between now and then is visible rather than described.
 *
 * Lives on the home screen, above the runs, because that is the screen a member
 * opens when they are deciding.
 */
export function TierProgressBar({
  tier,
  points,
  pointsToNext,
}: {
  tier: MemberTier;
  points: number;
  pointsToNext: number | null;
}) {
  const atTop = pointsToNext === null;
  const next = atTop ? tier : TIER_ORDER[TIER_ORDER.indexOf(tier) + 1]!;
  const fraction = tierProgressFraction(tier, pointsToNext);

  return (
    <View style={styles.wrap} accessibilityRole="progressbar">
      <View style={styles.textCol}>
        <View style={styles.headRow}>
          <Text style={[styles.currentTier, { color: TIER_COLOR[tier] }]}>{TIER_LABEL[tier]}</Text>
          <Text style={styles.points}>{points.toLocaleString()} pts</Text>
        </View>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: TIER_COLOR[tier] }]} />
        </View>

        <Text style={styles.caption} numberOfLines={1}>
          {atTop
            ? 'Top of the ladder. Nothing left to chase.'
            : `${pointsToNext} to ${TIER_LABEL[next]}`}
        </Text>
      </View>

      {/* Unlocked only at the very top, where the badge beside the bar is the
          one the member already holds rather than one still to come. */}
      <TierBadge tier={next} size={54} locked={!atTop} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  textCol: { flex: 1, gap: 6 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  currentTier: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  points: { ...typography.data, fontSize: 14, color: colors.textOnDark },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: '#333B4D', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  caption: { fontSize: 12, color: colors.textOnDarkMuted },
});
