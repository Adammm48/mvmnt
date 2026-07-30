import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, type Placement } from '@mvmnt/shared';
import { mediaUri } from '@/lib/media';

/**
 * The sponsor strip.
 *
 * Two rules shape this, both about not being the reason something else breaks:
 *
 *   · If there is no active sponsor it renders nothing at all — no empty box,
 *     no placeholder. A club with no sponsor should not look like a club whose
 *     sponsor failed to load.
 *   · Every call is fire-and-forget. A sponsor metric must never be the reason
 *     a member's home screen errors or waits, so a failed impression is
 *     swallowed on purpose. That is the one place in this app where swallowing
 *     is right, because there is no member-facing consequence to report.
 *
 * The impression is recorded once per member per day server-side, so mounting
 * this component repeatedly costs nothing and inflates nothing.
 */
export function SponsorBanner({ runId }: { runId?: string }) {
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase
      .rpc('active_placements', runId ? { p_run_id: runId } : {})
      .then(({ data }) => {
        if (cancelled) return;
        const first = (data ?? [])[0] ?? null;
        setPlacement(first);
        // Recorded on render rather than on view: this sits above the fold on
        // the home screen, and the alternative is a scroll listener that costs
        // more than the number is worth.
        if (first) supabase.rpc('record_placement_seen', { p_placement_id: first.placement_id });
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (!placement) return null;

  return (
    <Pressable
      style={styles.wrap}
      accessibilityRole="link"
      accessibilityLabel={`Sponsored by ${placement.name}`}
      onPress={async () => {
        supabase.rpc('record_placement_tap', { p_placement_id: placement.placement_id });
        if (placement.url) {
          // A sponsor's link is the one outbound URL in the app. Guarded, since
          // openURL rejects when nothing can handle it — and a dead tap on a
          // sponsor's banner is worse than no banner.
          await Linking.openURL(placement.url).catch(() => {});
        }
      }}
    >
      <Text style={styles.label}>Supported by</Text>
      <View style={styles.body}>
        {mediaUri(placement.logo_url) ? (
          <Image
            source={{ uri: mediaUri(placement.logo_url)! }}
            style={styles.logo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={styles.name}>{placement.name}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
    // Deliberately quiet. A sponsor strip that competes with the run cards is
    // one members learn to scroll past, which serves nobody — least of all the
    // sponsor paying for it.
    opacity: 0.92,
  },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textOnDarkMuted,
    fontWeight: '700',
  },
  body: { flexDirection: 'row', alignItems: 'center' },
  logo: { height: 26, width: 140 },
  name: { fontSize: 15, fontWeight: '700', color: colors.textOnDark },
});
