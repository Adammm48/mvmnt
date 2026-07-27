import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '@mvmnt/shared';

/**
 * The check-in celebration.
 *
 * App Spec §2 asks for this explicitly: "small celebratory micro-animations on
 * check-in — costs little, meaningfully increases the 'that felt good'
 * reaction that drives repeat use."
 *
 * Built with the Animated API rather than a confetti dependency — a dozen
 * animated views do the job, and a new dependency needs to justify itself
 * (Principles §1).
 *
 * Motion is decorative only: the confirmation is also stated in text, so a
 * member with reduced-motion preferences or a screen reader loses nothing.
 */

const PIECES = 14;
const CONFETTI_COLORS = [colors.action, colors.success, colors.highlight, '#FFFFFF'];

export function Celebration({ message }: { message: string }) {
  const pop = useRef(new Animated.Value(0)).current;
  const pieces = useRef(
    Array.from({ length: PIECES }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 90,
      useNativeDriver: true,
    }).start();

    Animated.stagger(
      28,
      pieces.map((piece) =>
        Animated.timing(piece, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [pop, pieces]);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.confettiLayer}>
        {pieces.map((piece, index) => {
          // Fan the pieces outward and let them fall, so the burst reads as
          // celebratory rather than as a loading spinner.
          const angle = (index / PIECES) * Math.PI * 2;
          const spread = 90 + (index % 4) * 26;

          const translateX = piece.interpolate({
            inputRange: [0, 1],
            outputRange: [0, Math.cos(angle) * spread],
          });
          const translateY = piece.interpolate({
            inputRange: [0, 0.45, 1],
            outputRange: [0, Math.sin(angle) * spread - 40, Math.sin(angle) * spread + 70],
          });
          const opacity = piece.interpolate({
            inputRange: [0, 0.7, 1],
            outputRange: [1, 1, 0],
          });
          const rotate = piece.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', `${index % 2 ? 260 : -260}deg`],
          });

          return (
            <Animated.View
              key={index}
              style={[
                styles.confetti,
                {
                  backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                  opacity,
                  transform: [{ translateX }, { translateY }, { rotate }],
                },
              ]}
            />
          );
        })}
      </View>

      <Animated.View
        style={[
          styles.badge,
          {
            transform: [
              { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
            ],
            opacity: pop,
          },
        ]}
      >
        <Text style={styles.tick}>✓</Text>
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md },
  confettiLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  confetti: { position: 'absolute', width: 9, height: 9, borderRadius: 2 },
  badge: {
    backgroundColor: colors.success,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 220,
  },
  tick: { fontSize: 34, fontWeight: '900', color: colors.base },
  message: { fontSize: 16, fontWeight: '800', color: colors.base, textAlign: 'center' },
});
