import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { loadFriends, nextRun } from '@/lib/friends';
import { Button } from '@/components/Button';
import { EmptyState, Loading, Notice } from '@/components/Feedback';
import { confirmDestructive } from '@/lib/confirm';
import {
  colors,
  radius,
  spacing,
  describeFriendState,
  formatRunDate,
  formatRunTime,
  toMemberMessage,
  MIN_TOUCH_TARGET,
  type FriendRow,
  type Run,
} from '@mvmnt/shared';

/**
 * Friends.
 *
 * Everything here is scoped to one question: who that I know is coming to the
 * next run? There is no history, no points and no per-run log, because a
 * friends list carrying stats is a leaderboard at n=2 and would re-expose the
 * per-run attendance the club deliberately hides.
 *
 * There is also no search and no way in except scanning a code in person
 * (App Spec §4.4).
 */
export default function FriendsScreen() {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const upcoming = await nextRun();
      setRun(upcoming);
      setFriends(await loadFriends(upcoming?.id ?? null));
    } catch (e) {
      setError(toMemberMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload on focus so a friend just added by scanning appears immediately.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function nudge(friend: FriendRow) {
    if (!run) return;
    setBusyId(friend.friend_id);
    setError(null);
    setNote(null);

    const { error: pokeError } = await supabase.rpc('poke_friend', {
      p_friend_id: friend.friend_id,
      p_run_id: run.id,
    });

    setBusyId(null);
    if (pokeError) {
      setError(toMemberMessage(pokeError));
      return;
    }
    setNote(`${friend.display_name} has been nudged.`);
    load();
  }

  async function remove(friend: FriendRow) {
    const confirmed = await confirmDestructive({
      title: `Remove ${friend.display_name}?`,
      message:
        'They will not be told. You will stop seeing whether they are coming, and they will stop seeing you. To add each other again you would both need to be there in person.',
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    setBusyId(friend.friend_id);
    const { error: removeError } = await supabase.rpc('remove_friend', {
      p_friend_id: friend.friend_id,
    });
    setBusyId(null);

    if (removeError) {
      setError(toMemberMessage(removeError));
      return;
    }
    load();
  }

  if (loading) return <Loading label="Loading friends" />;

  return (
    <FlatList
      style={styles.screen}
      data={friends}
      keyExtractor={(f) => f.friend_id}
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
          {error && <Notice tone="error" message={error} />}
          {note && !error && <Notice tone="success" message={note} />}

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button label="Show my code" onPress={() => router.push('/friends/code')} />
            </View>
            <View style={styles.action}>
              <Button
                label="Scan a code"
                variant="secondary"
                onPress={() => router.push('/friends/scan')}
              />
            </View>
          </View>

          <Text style={styles.explainer}>
            You can only add someone by scanning their code while you are standing together. There is
            no search and no way to be added from a distance.
          </Text>

          {run ? (
            <Text style={styles.runLine}>
              For {run.title} · {formatRunDate(run.starts_at)} {formatRunTime(run.starts_at)}
            </Text>
          ) : (
            <Text style={styles.runLine}>No run on the calendar yet.</Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <FriendCard
          friend={item}
          canNudge={run !== null}
          busy={busyId === item.friend_id}
          onNudge={() => nudge(item)}
          onRemove={() => remove(item)}
        />
      )}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      ListEmptyComponent={
        <EmptyState
          title="No friends yet"
          body="Next time you are at a run, show your code and get theirs. Then you will see who is coming before you set off."
          voice="empty_friends"
        />
      }
    />
  );
}

function FriendCard({
  friend,
  canNudge,
  busy,
  onNudge,
  onRemove,
}: {
  friend: FriendRow;
  canNudge: boolean;
  busy: boolean;
  onNudge: () => void;
  onRemove: () => void;
}) {
  const coming = friend.state === 'signed_up' || friend.state === 'checked_in';

  return (
    <View style={styles.card}>
      {friend.avatar_url ? (
        <Image source={{ uri: friend.avatar_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>
            {friend.display_name.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
      )}

      <View style={styles.cardBody}>
        <Text style={styles.name} numberOfLines={1}>
          {friend.display_name}
        </Text>
        <Text style={[styles.state, coming && styles.stateComing]}>
          {describeFriendState(friend.state)}
        </Text>
      </View>

      {/*
        The nudge is offered only when there is something to nudge about and
        it has not already been used. The cap is one per friend per run — a
        button that looks available and then errors is worse than one that
        plainly says it has been used.
      */}
      {canNudge && !coming && (
        <Pressable
          onPress={onNudge}
          disabled={busy || friend.already_poked}
          accessibilityRole="button"
          accessibilityLabel={
            friend.already_poked
              ? `Already nudged ${friend.display_name}`
              : `Nudge ${friend.display_name} about this run`
          }
          style={({ pressed }) => [
            styles.nudge,
            friend.already_poked && styles.nudgeDone,
            pressed && !busy && !friend.already_poked && styles.pressed,
          ]}
        >
          <Text style={[styles.nudgeText, friend.already_poked && styles.nudgeDoneText]}>
            {friend.already_poked ? 'Nudged' : 'Nudge'}
          </Text>
        </Pressable>
      )}

      <Pressable
        onPress={onRemove}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${friend.display_name}`}
        hitSlop={10}
        style={styles.remove}
      >
        <Text style={styles.removeText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  header: { gap: spacing.md, marginBottom: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  explainer: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 19 },
  runLine: { fontSize: 14, fontWeight: '600', color: colors.textOnDark },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.sm,
    paddingRight: spacing.md,
  },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: '#333B4D' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 17, fontWeight: '800', color: colors.textOnDark },
  cardBody: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '700', color: colors.textOnDark },
  state: { fontSize: 13, color: colors.textOnDarkMuted },
  stateComing: { color: colors.success, fontWeight: '600' },

  nudge: {
    minHeight: MIN_TOUCH_TARGET - 12,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.action,
  },
  nudgeDone: { borderColor: '#3A4152' },
  nudgeText: { fontSize: 14, fontWeight: '700', color: colors.action },
  nudgeDoneText: { color: colors.textOnDarkMuted },
  pressed: { opacity: 0.85 },
  remove: { padding: spacing.xs },
  removeText: { fontSize: 16, color: colors.textOnDarkMuted },
});
