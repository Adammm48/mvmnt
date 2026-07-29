import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  TIER_COLOR,
  TIER_FLOOR,
  TIER_LABEL,
  TIER_ORDER,
  type MemberTier,
  type TierReward,
} from '@mvmnt/shared';

/**
 * The whole ladder, with what each rung is worth.
 *
 * All five are shown, not just the next one. A member deciding whether this is
 * worth their Saturday mornings is deciding about the top of the ladder, and a
 * reward you cannot see is not a reward you are working towards — the same
 * reason the badge grid on the profile shows the ones still locked.
 *
 * Rewards come from the database rather than the app, so the club can change
 * what Legend is worth without a release (migration 0026).
 */
export function TierLadder({
  current,
  points,
  rewards,
}: {
  current: MemberTier;
  points: number;
  rewards: TierReward[];
}) {
  const rewardFor = new Map(rewards.map((r) => [r.tier, r]));
  const currentIndex = TIER_ORDER.indexOf(current);

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>The ladder</Text>
      <Text style={styles.caption}>
        Every tier comes with something from the club. Six months of not missing a Saturday takes
        you the whole way.
      </Text>

      {TIER_ORDER.map((tier, index) => {
        const reached = index <= currentIndex;
        const isCurrent = tier === current;
        const reward = rewardFor.get(tier);
        const floor = TIER_FLOOR[tier];

        return (
          <View
            key={tier}
            style={[styles.row, isCurrent && { borderColor: TIER_COLOR[tier], borderWidth: 1.5 }]}
            accessibilityRole="text"
            accessibilityLabel={`${TIER_LABEL[tier]}, ${floor} points${reached ? ', reached' : ''}`}
          >
            {/* Every rung wears its own colour, reached or not (owner call:
                "colored and unique for every tier"). Unreached rungs show the
                colour at reduced opacity — aspiration, not absence. */}
            <View
              style={[
                styles.marker,
                { backgroundColor: TIER_COLOR[tier], opacity: reached ? 1 : 0.35 },
              ]}
            />

            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text
                  style={[
                    styles.tier,
                    { color: TIER_COLOR[tier], opacity: reached ? 1 : 0.65 },
                  ]}
                >
                  {TIER_LABEL[tier]}
                </Text>
                <Text style={styles.threshold}>
                  {floor === 0 ? 'from the start' : `${floor} pts`}
                </Text>
              </View>

              {reward ? (
                <Text style={[styles.reward, !reached && styles.rewardLocked]}>
                  {reward.reward}
                  {/* Flagged rather than hidden: the club has not settled these
                      yet, and a placeholder that reads like a firm offer is a
                      promise nobody agreed to make. */}
                  {reward.is_placeholder ? '  ·  being confirmed' : ''}
                </Text>
              ) : null}

              {isCurrent && <Text style={styles.youAreHere}>You are here — {points} points</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  heading: { fontSize: 18, fontWeight: '700', color: colors.textOnDark },
  caption: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 19, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: spacing.sm,
    alignItems: 'flex-start',
  },
  marker: { width: 4, alignSelf: 'stretch', borderRadius: radius.pill, minHeight: 34 },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tier: { fontSize: 14, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  threshold: { ...typography.data, fontSize: 13, color: colors.textOnDarkMuted },
  reward: { fontSize: 14, color: colors.textOnDark, lineHeight: 20 },
  rewardLocked: { color: colors.textOnDarkMuted },
  youAreHere: { fontSize: 12, fontWeight: '700', color: colors.success, marginTop: 2 },
});
