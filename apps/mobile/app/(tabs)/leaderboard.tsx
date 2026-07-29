import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { StandingCard } from '@/components/StandingCard';
import { TierLadder } from '@/components/TierLadder';
import { ShareSheet } from '@/components/ShareSheet';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth';
import { EmptyState, Loading, Notice } from '@/components/Feedback';
import {
  colors,
  radius,
  spacing,
  typography,
  adamSays,
  rankBadge,
  sharedRanks,
  toMemberMessage,
  TIER_COLOR,
  type LeaderboardRow,
  type LeaderboardWindow,
  type Standing,
  type TierReward,
} from '@mvmnt/shared';

/**
 * The board.
 *
 * This screen is the single place in MVMNT where a member sees another member's
 * name — every other screen in Phase 1 was built so that was impossible. The
 * exception is deliberate and owner-decided; the residual privacy risks it
 * carries are recorded in ADR 0003, and the opt-out that answers them lives on
 * the profile screen.
 *
 * A member's own standing sits above the list rather than only inside it,
 * because most of the club will never be in the top 100 and the screen has to
 * be worth opening for them too.
 */
export default function LeaderboardScreen() {
  const { profile } = useAuth();
  const [sharing, setSharing] = useState(false);
  const [window, setWindow] = useState<LeaderboardWindow>('all_time');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [standing, setStanding] = useState<Standing | null>(null);
  // Always fetched, because tier, badges progress, runs and streak are lifetime
  // facts that the month view still has to state correctly.
  const [lifetime, setLifetime] = useState<Standing | null>(null);
  const [rewards, setRewards] = useState<TierReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      setError(null);

      const [board, mine, allTime, tiers] = await Promise.all([
        supabase.rpc('leaderboard', { p_window: window }),
        supabase.rpc('my_standing', { p_window: window }),
        window === 'all_time'
          ? Promise.resolve({ data: null, error: null })
          : supabase.rpc('my_standing', { p_window: 'all_time' }),
        supabase.from('tier_rewards').select('*'),
      ]);

      if (board.error || mine.error) {
        setError(toMemberMessage(board.error ?? mine.error!));
      } else if (tiers.error) {
        // The board itself is fine — only the ladder failed. Show what works
        // and say what did not, rather than replacing the whole screen with an
        // error or (as before) silently rendering an empty ladder.
        setRows(board.data ?? []);
        setStanding((mine.data ?? [])[0] ?? null);
        setLifetime((allTime.data ?? [])[0] ?? null);
        setError("Couldn't load the tier rewards. Pull down to try again.");
      } else {
        setRows(board.data ?? []);
        setStanding((mine.data ?? [])[0] ?? null);
        setLifetime((allTime.data ?? [])[0] ?? null);
        setRewards(tiers.data ?? []);
      }

      setLoading(false);
      setRefreshing(false);
    },
    [window],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading label="Loading the board" />;

  const tied = sharedRanks(rows);

  return (
    <>
      {sharing && standing && (
        <ShareSheet
          standing={lifetime ?? standing}
          displayName={profile?.display_name ?? 'A runner'}
          onClose={() => setSharing(false)}
        />
      )}
      <FlatList
        style={styles.screen}
        data={rows}
        keyExtractor={(row) => row.user_id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.textOnDarkMuted}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {error && (
              <View style={styles.errorBlock}>
                <Notice tone="error" message={error} />
                {/*
                  A visible way back. Pull-to-refresh works, but when the board
                  fails to load there is nothing on screen to pull and no hint
                  that pulling is the answer — so a transient blip looked like
                  a dead end.
                */}
                <Button label="Try again" variant="secondary" onPress={() => load(true)} />
              </View>
            )}
            {standing && <StandingCard standing={standing} lifetime={lifetime ?? undefined} />}

            <View style={styles.toggle}>
              <Segment
                label="All time"
                active={window === 'all_time'}
                onPress={() => setWindow('all_time')}
              />
              <Segment
                label="This month"
                active={window === 'month'}
                onPress={() => setWindow('month')}
              />
            </View>

            <Text style={styles.caption}>
              Top 100. Points come from showing up — checking in to a run earns them, and a streak
              of consecutive weeks adds a little more.
            </Text>

            {/* Only for the podium, and only for the member who is on it. A note
              congratulating somebody else is not a note for you. */}
            {standing && standing.rank <= 3 && standing.points > 0 && (
              <Text style={styles.podium}>{adamSays('top_three', { stability: 'daily' })}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => <Row row={item} shared={tied.has(item.rank)} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={
          standing ? (
            <View style={styles.ladder}>
              <View style={styles.shareRow}>
                <Button
                  label="Share your standing"
                  variant="secondary"
                  onPress={() => setSharing(true)}
                />
              </View>

              <TierLadder
                current={(lifetime ?? standing).tier}
                points={(lifetime ?? standing).points}
                rewards={rewards}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            title="Nobody on the board yet"
            body="The first check-in of the season puts someone here. It may as well be you."
            voice="empty_board"
          />
        }
      />
    </>
  );
}

function Segment({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.segment, active && styles.segmentActive]}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({ row, shared }: { row: LeaderboardRow; shared: boolean }) {
  const medal = !shared && row.rank <= 3;

  return (
    <View
      style={[styles.row, row.is_me && styles.rowMe]}
      accessibilityRole="text"
      accessibilityLabel={
        shared
          ? `Joint number ${row.rank}, ${row.display_name}, ${row.points} points`
          : `Number ${row.rank}, ${row.display_name}, ${row.points} points`
      }
    >
      <Text style={[styles.rank, medal && styles.rankMedal]}>{rankBadge(row.rank, shared)}</Text>

      {row.avatar_url ? (
        <Image source={{ uri: row.avatar_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>
            {row.display_name.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
      )}

      <View style={styles.nameCol}>
        <Text style={styles.name} numberOfLines={1}>
          {row.display_name}
          {row.is_me ? '  ·  you' : ''}
        </Text>
        <Text style={[styles.tier, { color: TIER_COLOR[row.tier] }]}>{row.tier.toUpperCase()}</Text>
      </View>

      <Text style={styles.points}>{row.points.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  errorBlock: { gap: spacing.sm },
  screen: { flex: 1, backgroundColor: colors.base },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  header: { gap: spacing.md, marginBottom: spacing.md },
  ladder: { marginTop: spacing.xl },
  shareRow: { marginBottom: spacing.lg },
  caption: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 19 },
  podium: { fontSize: 14, color: colors.highlight, fontStyle: 'italic' },

  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.baseElevated,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.action },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.textOnDarkMuted },
  segmentTextActive: { color: colors.textOnAction },

  separator: { height: 1, backgroundColor: colors.border, marginLeft: 56 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowMe: { backgroundColor: colors.baseElevated },
  rank: {
    ...typography.data,
    width: 28,
    textAlign: 'center',
    color: colors.textOnDarkMuted,
  },
  rankMedal: { fontSize: 20 },
  avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.border },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 15, fontWeight: '800', color: colors.textOnDark },
  nameCol: { flex: 1, gap: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.textOnDark },
  tier: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  points: { ...typography.data, color: colors.textOnDark },
});
