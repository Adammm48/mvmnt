import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useRuns } from '@/lib/useRuns';
import { supabase } from '@/lib/supabase';
import { RunCard } from '@/components/RunCard';
import { TierProgressBar } from '@/components/TierProgressBar';
import { TierChest, type UnclaimedTier } from '@/components/TierChest';
import { Welcome } from '@/components/Welcome';
import { SponsorBanner } from '@/components/SponsorBanner';
import { clearSync, useLastSync } from '@/lib/syncStatus';
import { EmptyState, Loading, Notice } from '@/components/Feedback';
import { registerForPush } from '@/lib/push';
import {
  colors,
  radius,
  spacing,
  typography,
  toMemberMessage,
  adamSays,
  greetingSlot,
  TIER_COLOR,
  TIER_LABEL,
  type Standing,
} from '@mvmnt/shared';

export default function Home() {
  const { session, profile } = useAuth();
  const router = useRouter();
  const { items, loading, refreshing, error, reload } = useRuns(session?.user.id);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [chest, setChest] = useState<UnclaimedTier | null>(null);
  const sync = useLastSync();

  // Clears itself after a beat. Good news does not need to be dismissed by
  // hand, and a banner that outstays the moment becomes part of the furniture.
  useEffect(() => {
    if (!sync || sync.failed) return;
    const timer = setTimeout(clearSync, 9000);
    return () => clearTimeout(timer);
  }, [sync]);

  // Registering on every launch is what keeps a handed-down device pointed at
  // its current owner — register_push_token() reassigns on conflict.
  useEffect(() => {
    // Fire and forget by design — this runs on every launch to keep a
    // handed-down phone pointed at its current owner, and is not a moment to
    // interrupt anybody. The outcome is not lost, though: the profile screen
    // reads the same state and says so there, where it is actionable.
    registerForPush().catch(() => {});
  }, []);

  // Coming back from a run detail should show the join that just happened —
  // and the points a check-in just earned.
  useFocusEffect(
    useCallback(() => {
      reload();
      supabase
        .rpc('my_standing', { p_window: 'all_time' })
        .then(({ data }) => setStanding((data ?? [])[0] ?? null));
      // Anything they crossed since they last looked. Oldest first, so somebody
      // returning after two rungs sees them in the order they earned them.
      supabase
        .rpc('my_unclaimed_tiers')
        .then(({ data }) => setChest((data ?? [])[0] ?? null));
    }, [reload]),
  );

  if (loading) return <Loading label="Loading runs" />;

  const firstName = profile?.display_name?.split(' ')[0];

  return (
    <View style={styles.screen}>
      <Welcome />
      {chest && (
        <TierChest
          award={chest}
          onClaim={async () => {
            await supabase.rpc('acknowledge_tier', { p_tier: chest.tier });
            const { data } = await supabase.rpc('my_unclaimed_tiers');
            setChest((data ?? [])[0] ?? null);
          }}
        />
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => item.run.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => reload(true)}
            tintColor={colors.textOnDarkMuted}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.greeting}>
                  {firstName ? `Hey ${firstName}` : 'Welcome'}
                </Text>
                <Text style={styles.subGreeting}>{encouragement(items.length)}</Text>
              </View>
              <Pressable
                onPress={() => router.push('/profile')}
                accessibilityRole="button"
                accessibilityLabel="Profile and settings"
                hitSlop={12}
              >
                <Text style={styles.profileLink}>Profile</Text>
              </Pressable>
            </View>
            {/* One line a day, chosen for this member. It does not reshuffle
                while they look at it — see voice.ts. */}
            <Text style={styles.adam}>
              Adam says: {adamSays(greetingSlot(), { userId: session?.user.id, stability: 'daily' })}
            </Text>

            {standing && (
              <TierProgressBar
                tier={standing.tier}
                points={standing.points}
                pointsToNext={standing.points_to_next_tier}
              />
            )}

            {error && <Notice tone="error" message={toMemberMessage({ message: error })} />}

            {/*
              The offline queue, finally speaking. A check-in tapped in a dead
              spot lands minutes or hours later, and the member has no other way
              to know it worked.
            */}
            {sync && (
              <Notice
                tone={sync.failed ? 'error' : sync.synced > 0 ? 'success' : 'info'}
                onDismiss={clearSync}
                message={
                  sync.failed
                    ? 'Could not sync your saved check-ins. They are still saved and will try again.'
                    : sync.synced > 0
                      ? `${sync.synced} check-in${sync.synced === 1 ? '' : 's'} synced. You are in.`
                      : `${sync.remaining} check-in${sync.remaining === 1 ? '' : 's'} still waiting for signal.`
                }
              />
            )}

            {/*
              Three ways out of the home screen, and the member's own number on
              one of them. App Spec §2 asks for momentum to be visible without
              being demanded — this shows what they have, and never what they
              have missed.
            */}
            <View style={styles.chips}>
              <Pressable
                style={styles.chip}
                onPress={() => router.push('/leaderboard')}
                accessibilityRole="button"
                accessibilityLabel="The board"
              >
                <Text style={styles.chipTitle}>The board</Text>
                {standing ? (
                  <Text style={styles.chipValue}>
                    {standing.points.toLocaleString()}
                    <Text style={styles.chipUnit}> pts</Text>
                  </Text>
                ) : (
                  <Text style={styles.chipUnit}>Where you stand</Text>
                )}
                {standing && (
                  <Text style={[styles.chipTier, { color: TIER_COLOR[standing.tier] }]}>
                    {TIER_LABEL[standing.tier].toUpperCase()}
                  </Text>
                )}
              </Pressable>

              <Pressable
                style={styles.chip}
                onPress={() => router.push('/friends')}
                accessibilityRole="button"
                accessibilityLabel="Friends"
              >
                <Text style={styles.chipTitle}>Friends</Text>
                <Text style={styles.chipUnit}>See who&apos;s coming</Text>
              </Pressable>

              <Pressable
                style={styles.chip}
                onPress={() => router.push('/shop')}
                accessibilityRole="button"
                accessibilityLabel="Shop"
              >
                <Text style={styles.chipTitle}>Shop</Text>
                <Text style={styles.chipUnit}>Spend your points</Text>
              </Pressable>
            </View>

            {/* Below the club's own content, never above it. */}
            <SponsorBanner />
          </View>
        }
        renderItem={({ item }) => (
          <RunCard
            run={item.run}
            counts={item.counts}
            myState={item.myState}
            onPress={() => router.push(`/run/${item.run.id}`)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            title="Nothing on the calendar yet"
            body="The moment the organisers drop the next run, it lands here and we'll ping you. Won't be long."
            voice="empty_runs"
            userId={session?.user.id}
          />
        }
      />
    </View>
  );
}

/**
 * A warm line under the greeting. App Spec §2 asks for momentum framed
 * positively — the copy leans on what is coming up rather than counting what
 * anyone has missed.
 */
function encouragement(count: number): string {
  if (count === 0) return 'Next run drops soon';
  if (count === 1) return 'One run on the horizon';
  return `${count} runs coming up`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  header: { marginBottom: spacing.lg, gap: spacing.sm, paddingTop: spacing.xs },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { fontSize: 30, fontWeight: '900', color: colors.textOnDark, letterSpacing: -0.5 },
  subGreeting: { fontSize: 15, color: colors.textOnDarkMuted, marginTop: 2 },
  profileLink: { fontSize: 15, fontWeight: '600', color: colors.textOnDarkMuted },
  chips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    flex: 1,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 2,
    justifyContent: 'center',
  },
  chipTitle: { fontSize: 13, fontWeight: '700', color: colors.textOnDarkMuted },
  chipValue: { ...typography.dataLarge, fontSize: 24, color: colors.textOnDark },
  chipUnit: { fontSize: 13, fontWeight: '400', color: colors.textOnDarkMuted },
  chipTier: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  adam: { fontSize: 14, color: colors.textOnDarkMuted, lineHeight: 20, fontStyle: 'italic' },
});
