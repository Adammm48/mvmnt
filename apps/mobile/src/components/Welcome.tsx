import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, SIGNATURE } from '@mvmnt/shared';
import { Button } from './Button';

const SEEN_KEY = 'mvmnt.welcome.seen.v1';

/**
 * Shown once, on the very first launch, and never again.
 *
 * The only moment where a member has not yet formed an opinion about the app,
 * which makes it the one place a credit reads as an introduction rather than an
 * interruption. Everything after this has to earn attention; this does not.
 *
 * Versioned key, so a future rewrite of this screen can show once more without
 * the flag having to be cleared by hand — and, more importantly, so it never
 * reappears just because the app updated.
 */
export function Welcome() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY).then((seen) => {
      if (!seen) setShow(true);
    });
  }, []);

  async function dismiss() {
    setShow(false);
    // Written after dismissal rather than on show: if the app dies while this
    // is up, the member should still get their introduction.
    await AsyncStorage.setItem(SEEN_KEY, new Date().toISOString());
  }

  if (!show) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.wordmark}>MVMNT</Text>
          <Text style={styles.welcome}>Welcome to the club.</Text>
          <Text style={styles.body}>
            Every run in one place. Sign up, turn up, check in — and see how far you have come.
          </Text>
          <Button label="Let’s go" onPress={dismiss} />
          <Text style={styles.credit}>Crafted by {SIGNATURE.name}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 12, 18, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    maxWidth: 360,
  },
  wordmark: { fontSize: 34, fontWeight: '900', color: colors.textOnDark, letterSpacing: 6 },
  welcome: { fontSize: 20, fontWeight: '800', color: colors.textOnDark },
  body: {
    fontSize: 15,
    color: colors.textOnDarkMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  credit: { fontSize: 12, color: colors.textOnDarkMuted, opacity: 0.75, marginTop: spacing.xs },
});
