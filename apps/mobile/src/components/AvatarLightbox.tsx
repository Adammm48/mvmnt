import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Modal, Pressable, StyleSheet, Text } from 'react-native';
import { colors, spacing } from '@mvmnt/shared';

/**
 * A profile picture, big — the Instagram gesture everyone's thumb already
 * knows. Tap an avatar, the photo springs up as a large circle over a dimmed
 * screen; tap anywhere to put it back.
 *
 * One Modal, tap-anywhere-to-close, nothing nested. The photo viewer taught
 * this file's rules the hard way: iOS freezes on sibling modals AND on a
 * nested pair dismissed in one frame, so a lightbox gets a single layer and a
 * single dismissal. Tap-to-close is safe here where it fought the gallery's
 * swipe — there is no gesture inside this one to fight.
 *
 * The spring is the Celebration's Animated API, native driver, no new
 * dependency. It scales from the centre rather than from the tapped avatar —
 * a true shared-element flight needs a library and layout measurement, and
 * the 250ms spring reads as "that photo, closer" without either.
 */
export function AvatarLightbox({
  uri,
  label,
  onClose,
}: {
  uri: string;
  /** Whose face this is — drawn under the photo on other people's avatars. */
  label?: string;
  onClose: () => void;
}) {
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pop, {
      toValue: 1,
      useNativeDriver: true,
      friction: 7,
      tension: 60,
    }).start();
  }, [pop]);

  const size = Math.min(Dimensions.get('window').width * 0.82, 360);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the photo"
      >
        <Animated.Image
          source={{ uri }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [
              { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
            ],
            opacity: pop,
          }}
        />
        {label ? <Text style={styles.label}>{label}</Text> : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  label: { color: colors.textOnDark, fontSize: 17, fontWeight: '700' },
});
