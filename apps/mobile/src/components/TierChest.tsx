import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  SIGNATURE,
  TIER_COLOR,
  TIER_LABEL,
  type MemberTier,
} from '@mvmnt/shared';
import { TierBadge } from './TierBadge';
import { Button } from './Button';

export type UnclaimedTier = {
  tier: MemberTier;
  reached_at: string;
  reward: string;
  is_placeholder: boolean;
};

/**
 * The chest.
 *
 * Fires the moment a member crosses a tier — which in practice is thirty
 * seconds after they check in at a meeting point, standing in a car park in the
 * cold. So it opens on a tap rather than automatically: the reveal is the
 * moment, and a reveal that has already happened by the time you look at your
 * phone is not one.
 *
 * Two stages on purpose. A closed chest is a question, and the answer is worth
 * a beat.
 */
export function TierChest({
  award,
  onClaim,
}: {
  award: UnclaimedTier;
  /** Marks it seen. Called once the member has actually looked at it. */
  onClaim: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const color = TIER_COLOR[award.tier];

  // The closed chest rocks, so it reads as something to press rather than an
  // illustration. Stops once opened — motion after the reveal is just noise.
  useEffect(() => {
    if (open) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 140, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 140, useNativeDriver: true }),
        Animated.delay(1400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [open, shake]);

  function openChest() {
    setOpen(true);
    Animated.timing(reveal, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    }).start();
  }

  const rotate = shake.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] });

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClaim}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { borderColor: color }]}>
          {!open ? (
            <>
              <Text style={styles.eyebrow}>You reached</Text>
              <Text style={[styles.tier, { color }]}>{TIER_LABEL[award.tier]}</Text>

              <Pressable
                onPress={openChest}
                accessibilityRole="button"
                accessibilityLabel={`Open your ${TIER_LABEL[award.tier]} chest`}
                hitSlop={16}
              >
                <Animated.Text style={[styles.chest, { transform: [{ rotate }] }]}>🎁</Animated.Text>
              </Pressable>

              <Text style={styles.tapHint}>Tap to open</Text>
            </>
          ) : (
            <Animated.View
              style={[
                styles.revealed,
                {
                  opacity: reveal,
                  transform: [
                    { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                  ],
                },
              ]}
            >
              <TierBadge tier={award.tier} size={104} />
              <Text style={[styles.tier, { color }]}>{TIER_LABEL[award.tier]}</Text>

              <View style={[styles.giftBox, { borderColor: color }]}>
                {/* An unconfirmed reward must not read as a broken promise at
                    the app's biggest emotional moment (audit finding). The
                    chest keeps its ceremony — the specific prize is framed as
                    being engraved, not as missing. */}
                {award.is_placeholder ? (
                  <>
                    <Text style={styles.giftFrom}>{SIGNATURE.giftFrom} owes you a gift</Text>
                    <Text style={styles.giftReward}>It&rsquo;s being engraved.</Text>
                    <Text style={styles.giftPending}>
                      The club is choosing something worthy of {TIER_LABEL[award.tier]} — you will
                      be the first to hear.
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.giftFrom}>{SIGNATURE.giftFrom} has gifted you</Text>
                    <Text style={styles.giftReward}>{award.reward || 'something good'}</Text>
                  </>
                )}
              </View>

              <Button label="Nice" onPress={onClaim} />
            </Animated.View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 12, 18, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
    maxWidth: 380,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textOnDarkMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tier: { ...typography.display, fontSize: 34, letterSpacing: -0.5 },
  chest: { fontSize: 96, textAlign: 'center', marginVertical: spacing.md },
  tapHint: { fontSize: 14, color: colors.textOnDarkMuted },
  revealed: { alignItems: 'center', gap: spacing.md, width: '100%' },
  giftBox: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: 4,
    width: '100%',
  },
  giftFrom: { fontSize: 13, color: colors.textOnDarkMuted },
  giftReward: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textOnDark,
    textAlign: 'center',
    lineHeight: 24,
  },
  giftPending: {
    fontSize: 12,
    color: colors.highlight,
    textAlign: 'center',
    marginTop: 4,
  },
});
