import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  describeStreakShort,
  SIGNATURE,
  TIER_COLOR,
  TIER_LABEL,
  type Standing,
} from '@mvmnt/shared';
import { TierBadge } from './TierBadge';

/**
 * The card a member posts to Instagram.
 *
 * The highest-reach thing in this repo, and the only attribution that travels
 * beyond people who already have the app. Everything else in the signature
 * work is seen by members; this is seen by their friends.
 *
 * Which is exactly why the credit at the bottom is one small line and the club
 * is the headline. A card that looks like an advert for its developer is a card
 * nobody posts, and a card nobody posts reaches nobody. The restraint is not
 * modesty — it is the thing that makes it work.
 *
 * Fixed 1080×1350 (Instagram portrait). Laid out in points and captured at 3x
 * rather than guessed at, so text stays crisp.
 */
export const ShareCard = forwardRef<View, { standing: Standing; displayName: string }>(
  function ShareCard({ standing, displayName }, ref) {
    const tier = standing.tier;

    return (
      <View ref={ref} collapsable={false} style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>MVMNT</Text>
          <Text style={styles.tagline}>Run together.</Text>
        </View>

        <View style={styles.body}>
          <TierBadge tier={tier} size={128} />
          <Text style={[styles.tier, { color: TIER_COLOR[tier] }]}>{TIER_LABEL[tier]}</Text>
          <Text style={styles.name}>{displayName}</Text>

          <View style={styles.statRow}>
            <Stat value={standing.points.toLocaleString()} label="points" />
            <Stat value={`${standing.runs_attended}`} label={standing.runs_attended === 1 ? 'run' : 'runs'} />
            <Stat value={describeStreakShort(standing.streak_weeks)} label="streak" />
          </View>

          {/* Rank only when it is worth showing. "#218 of 300" on a card
              somebody is about to post is a reason not to post it. */}
          {standing.rank <= 10 && standing.points > 0 && (
            <Text style={[styles.rank, { color: TIER_COLOR[tier] }]}>
              #{standing.rank} in the club
            </Text>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerMain}>Powered by MVMNT</Text>
          <Text style={styles.footerCredit}>Built by {SIGNATURE.name}</Text>
        </View>
      </View>
    );
  },
);

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Instagram portrait, in points. Captured at 3x for 1080×1350. */
export const SHARE_CARD_SIZE = { width: 360, height: 450 };

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_SIZE.width,
    height: SHARE_CARD_SIZE.height,
    backgroundColor: colors.base,
    borderRadius: radius.lg,
    padding: spacing.lg,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  header: { alignItems: 'center', gap: 0 },
  wordmark: { fontSize: 26, fontWeight: '900', color: colors.textOnDark, letterSpacing: 5 },
  tagline: { fontSize: 12, color: colors.textOnDarkMuted, letterSpacing: 0.5 },
  body: { alignItems: 'center', gap: spacing.sm },
  tier: { fontSize: 30, fontWeight: '900', letterSpacing: -0.4, marginTop: spacing.xs },
  name: { fontSize: 17, color: colors.textOnDark, fontWeight: '600' },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    alignSelf: 'stretch',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#333B4D',
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { ...typography.dataLarge, fontSize: 24, color: colors.textOnDark },
  statLabel: { fontSize: 11, color: colors.textOnDarkMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  rank: { fontSize: 14, fontWeight: '800', marginTop: spacing.sm },
  footer: { alignItems: 'center', gap: 1 },
  footerMain: { fontSize: 13, fontWeight: '700', color: colors.textOnDarkMuted, letterSpacing: 0.6 },
  footerCredit: { fontSize: 11, color: colors.textOnDarkMuted, opacity: 0.7 },
});
