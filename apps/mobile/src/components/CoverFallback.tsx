import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

/**
 * What a run looks like before anyone has uploaded a photo.
 *
 * Most runs will have no cover at first, and a flat panel the same colour as
 * the page reads as a broken image rather than a deliberate one. So the
 * fallback is a gradient derived from the run's own id — stable for a given
 * run, different between runs, and always drawn from the App Spec §2 palette so
 * it looks like part of the product rather than a placeholder.
 */

// Deep, saturated pairs that keep white text legible without needing a scrim.
const GRADIENTS: [string, string][] = [
  ['#3A2418', '#1B1F2A'], // ember
  ['#12303A', '#1B1F2A'], // deep teal
  ['#2E1B33', '#1B1F2A'], // plum
  ['#1E3326', '#1B1F2A'], // forest
  ['#33251B', '#1B1F2A'], // clay
  ['#1B2540', '#1B1F2A'], // midnight blue
];

function pick(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length]!;
}

export function CoverFallback({
  seed,
  style,
  children,
}: {
  seed: string;
  style?: ViewStyle;
  children?: ReactNode;
}) {
  const [from, to] = pick(seed);
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.base, style]}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
});
