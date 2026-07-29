import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { adamSays, colors, radius, spacing, BUILD_FACTS, SIGNATURE } from '@mvmnt/shared';
import { Button } from './Button';

/**
 * The hidden developer card: tap the wordmark seven times.
 *
 * Marketing that works because it is earned rather than served. Nobody is
 * shown this; a curious member finds it, and a found thing gets screenshotted
 * and sent to a group chat, which is the only kind of reach worth having. The
 * app never hints at it — a hint would make it an advertisement.
 *
 * Seven taps because three is an accident and ten is a chore.
 */
export function useWordmarkEasterEgg() {
  const [taps, setTaps] = useState(0);
  const [open, setOpen] = useState(false);

  return {
    /** Spread onto the wordmark's Pressable. */
    onWordmarkPress: () => {
      const next = taps + 1;
      if (next >= 7) {
        setTaps(0);
        setOpen(true);
      } else {
        setTaps(next);
      }
    },
    /** How close they are, once they are clearly trying. Silent before that. */
    hint: taps >= 4 ? `${7 - taps} more…` : null,
    card: open ? <DeveloperCard onClose={() => setOpen(false)} /> : null,
  };
}

function DeveloperCard({ onClose }: { onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.found}>You found Adam.</Text>
          <Text style={styles.name}>{SIGNATURE.name}</Text>
          <Text style={styles.role}>{SIGNATURE.role}</Text>

          <View style={styles.facts}>
            {BUILD_FACTS.map((fact) => (
              <View key={fact.label} style={styles.factRow}>
                <Text style={styles.factValue}>{fact.value}</Text>
                <Text style={styles.factLabel}>{fact.label}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.voice}>{adamSays('secret_found')}</Text>
          <Button label="Back to running" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** The wordmark, made tappable. Used wherever the header shows MVMNT. */
export function TappableWordmark({
  onPress,
  hint,
  style,
}: {
  onPress: () => void;
  hint: string | null;
  style?: object;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="MVMNT">
      <Text style={[styles.wordmark, style]}>MVMNT</Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.base,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  found: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: colors.success,
    textTransform: 'uppercase',
  },
  name: { fontSize: 24, fontWeight: '900', color: colors.textPrimary },
  role: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginVertical: spacing.sm,
  },
  factRow: { alignItems: 'center', minWidth: 84 },
  factValue: { fontSize: 19, fontWeight: '800', color: colors.textPrimary },
  factLabel: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  voice: {
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  wordmark: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 4,
    color: colors.textPrimary,
  },
  hint: { fontSize: 10, color: colors.textSecondary, textAlign: 'center' },
});
